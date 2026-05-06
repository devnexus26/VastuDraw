/**
 * ════════════════════════════════════════════════════════════════
 * VastuDraw Pro — Google Apps Script Backend
 * File: appscript.gs
 *
 * ── HOW THE ROUTING WORKS ────────────────────────────────────
 *
 * Google Apps Script gives you exactly TWO HTTP entry points:
 *
 *   doGet(e)   → triggered by any GET  request to the Web App URL
 *   doPost(e)  → triggered by any POST request to the Web App URL
 *
 * There are no URL sub-paths (/login, /comments, etc.).
 * Instead, every request carries an "action" parameter that tells
 * our router which handler function to call:
 *
 *   GET  ?action=login        &email=x&password_hash=y
 *   GET  ?action=get_comments &client_id=CLI001
 *   GET  ?action=get_layout   &client_id=CLI001
 *   GET  ?action=get_clients
 *   POST { "action": "register",    "email":..., "password_hash":..., "name":... }
 *   POST { "action": "add_comment", "client_id":..., "message":..., ... }
 *   POST { "action": "save_layout", "client_id":..., "layout_json":... }
 *
 * Each handler reads from or writes to a tab in the Google Sheet
 * identified by SHEET_ID and returns a JSON response.
 *
 * ── DEPLOY SETTINGS ─────────────────────────────────────────
 *   Execute as:    Me
 *   Who has access: Anyone
 *
 * ── REQUIRED SHEET TABS (auto-created by setupSheets()) ─────
 *   1. Users    — email | password_hash | role | name | client_id
 *   2. Comments — id | client_id | room_tab | author | role | message | timestamp | parent_id
 *   3. Layouts  — client_id | layout_json | updated_at
 * ════════════════════════════════════════════════════════════════
 */

// ── CONFIGURATION ─────────────────────────────────────────────
// Paste your Google Sheet ID here.
// Find it in the Sheet URL: https://docs.google.com/spreadsheets/d/SHEET_ID/edit
const SHEET_ID = '1C1PLsEqvQ2UF_qdJShadG83SAB22oRKonWLzoZKHOqw';

const SHEET_USERS    = 'Users';
const SHEET_COMMENTS = 'Comments';
const SHEET_LAYOUTS  = 'Layouts';


// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * SHA-256 password hashing using Apps Script's built-in Utilities.
 * Apps Script has no crypto.subtle, so we use Utilities.computeDigest.
 * This produces the same hex string as crypto.subtle on the frontend,
 * so the hashes match across both environments.
 */
function sha256(value) {
  if (!value) throw new Error('sha256: value cannot be null or empty');
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function getSheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}


// ════════════════════════════════════════════════════════════════
// ROUTER — doGet
// All GET requests arrive here. We read e.parameter.action
// and dispatch to the right handler.
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = (e.parameter.action || '').trim();
  try {
    switch (action) {
      case 'login':        return handleLogin(e.parameter);
      case 'register':     return handleRegister(e.parameter);
      case 'get_comments': return handleGetComments(e.parameter);
      case 'add_comment':  return handleAddComment(e.parameter);
      case 'get_layout':   return handleGetLayout(e.parameter);
      case 'save_layout':  return handleSaveLayout(e.parameter);
      case 'get_clients':  return handleGetClients(e.parameter);
      default:
        return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ════════════════════════════════════════════════════════════════
// ROUTER — doPost
// All POST requests arrive here. We parse the JSON body and
// read body.action to dispatch to the right handler.
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON body' });
  }

  const action = (body.action || '').trim();
  try {
    switch (action) {
      case 'register':    return handleRegister(body);
      case 'add_comment': return handleAddComment(body);
      case 'save_layout': return handleSaveLayout(body);
      default:
        return jsonResponse({ success: false, error: 'Unknown POST action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}


// ════════════════════════════════════════════════════════════════
// ACTION: LOGIN
//
// Security model:
//   • The frontend hashes the password with SHA-256 (Web Crypto API)
//     BEFORE sending it. The plaintext password never leaves the browser.
//   • We compare the received hash against the stored hash.
//   • On match, return the user's name, role, and client_id.
//
// Sheet: Users  [ email | password_hash | role | name | client_id ]
// ════════════════════════════════════════════════════════════════
function handleLogin(params) {
  const email        = (params.email         || '').toLowerCase().trim();
  const passwordHash = (params.password_hash || '').trim();

  if (!email || !passwordHash) {
    return jsonResponse({ success: false, error: 'Email and password are required.' });
  }

  const data = getSheet(SHEET_USERS).getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).toLowerCase().trim() === email &&
        String(row[1]).trim()               === passwordHash) {
      return jsonResponse({
        success: true,
        user: {
          email:     String(row[0]).trim(),
          name:      String(row[3]).trim(),
          role:      String(row[2]).trim(),   // 'consultant' or 'client'
          client_id: String(row[4]).trim() || null
        }
      });
    }
  }

  return jsonResponse({ success: false, error: 'Invalid email or password.' });
}


// ════════════════════════════════════════════════════════════════
// ACTION: REGISTER  (self-registration for clients only)
//
// Consultants are added manually via addUser() — not self-register.
// The frontend sends: email, password_hash (already SHA-256'd), name.
// We store the hash — never the plaintext password.
// A unique client_id is auto-generated.
//
// Sheet: Users  [ email | password_hash | role | name | client_id ]
// ════════════════════════════════════════════════════════════════
function handleRegister(params) {
  const email        = (params.email         || '').toLowerCase().trim();
  const passwordHash = (params.password_hash || '').trim();
  const name         = (params.name          || '').trim();

  if (!email || !passwordHash || !name) {
    return jsonResponse({ success: false, error: 'Name, email, and password are required.' });
  }

  const sheet = getSheet(SHEET_USERS);
  const data  = sheet.getDataRange().getValues();

  // Duplicate email check
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email) {
      return jsonResponse({ success: false, error: 'An account with this email already exists.' });
    }
  }

  const clientId = 'CLI_' + Date.now();
  sheet.appendRow([email, passwordHash, 'client', name, clientId]);

  return jsonResponse({
    success: true,
    user: { email, name, role: 'client', client_id: clientId }
  });
}


// ════════════════════════════════════════════════════════════════
// ACTION: GET CLIENTS
// Returns all client-role users for the consultant's dropdown.
//
// Sheet: Users  [ email | password_hash | role | name | client_id ]
// ════════════════════════════════════════════════════════════════
function handleGetClients(params) {
  const data    = getSheet(SHEET_USERS).getDataRange().getValues();
  const clients = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[2]).trim().toLowerCase() === 'client') {
      clients.push({
        email:     String(row[0]).trim(),
        name:      String(row[3]).trim(),
        client_id: String(row[4]).trim()
      });
    }
  }

  return jsonResponse({ success: true, clients });
}


// ════════════════════════════════════════════════════════════════
// ACTION: GET COMMENTS
// Fetches all comments for a client_id, sorted oldest-first so
// replies appear below the parent comment in the UI.
//
// Sheet: Comments
//   id | client_id | room_tab | author | role | message | timestamp | parent_id
// ════════════════════════════════════════════════════════════════
function handleGetComments(params) {
  const clientId = (params.client_id || '').trim();
  if (!clientId) {
    return jsonResponse({ success: false, error: 'Missing client_id.' });
  }

  const data     = getSheet(SHEET_COMMENTS).getDataRange().getValues();
  const comments = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[1]).trim() !== clientId) continue;

    comments.push({
      id:        String(row[0]).trim(),
      client_id: String(row[1]).trim(),
      room_tab:  String(row[2]).trim(),
      author:    String(row[3]).trim(),
      role:      String(row[4]).trim(),
      message:   String(row[5]).trim(),
      timestamp: String(row[6]).trim(),
      parent_id: String(row[7]).trim() || null
    });
  }

  comments.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return jsonResponse({ success: true, comments });
}


// ════════════════════════════════════════════════════════════════
// ACTION: ADD COMMENT
// Appends one row to Comments. Works for both:
//   • Clients leaving a new comment (parent_id = '')
//   • Consultants replying (parent_id = id of the parent comment)
//
// Sheet: Comments
//   id | client_id | room_tab | author | role | message | timestamp | parent_id
// ════════════════════════════════════════════════════════════════
function handleAddComment(params) {
  const clientId = (params.client_id || '').trim();
  const roomTab  = (params.room_tab  || 'General').trim();
  const author   = (params.author    || '').trim();
  const role     = (params.role      || '').trim();
  const message  = (params.message   || '').trim();
  const parentId = (params.parent_id || '').trim();

  if (!clientId || !author || !message) {
    return jsonResponse({ success: false, error: 'client_id, author, and message are required.' });
  }

  if (role !== 'client' && role !== 'consultant') {
    return jsonResponse({ success: false, error: 'role must be "client" or "consultant".' });
  }

  const id        = 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const timestamp = new Date().toISOString();

  getSheet(SHEET_COMMENTS).appendRow([id, clientId, roomTab, author, role, message, timestamp, parentId]);

  return jsonResponse({ success: true, id, timestamp });
}


// ════════════════════════════════════════════════════════════════
// ACTION: SAVE LAYOUT
// Upserts the canvas JSON for a client.
// One row per client_id — updates existing or appends new.
//
// Sheet: Layouts  [ client_id | layout_json | updated_at ]
// ════════════════════════════════════════════════════════════════
function handleSaveLayout(params) {
  const clientId   = (params.client_id   || '').trim();
  const layoutJson = (params.layout_json || '').trim();

  if (!clientId || !layoutJson) {
    return jsonResponse({ success: false, error: 'client_id and layout_json are required.' });
  }

  const sheet    = getSheet(SHEET_LAYOUTS);
  const data     = sheet.getDataRange().getValues();
  const now      = new Date().toISOString();
  let   foundRow = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === clientId) {
      foundRow = i + 1; // Sheets API is 1-indexed
      break;
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 2).setValue(layoutJson);
    sheet.getRange(foundRow, 3).setValue(now);
  } else {
    sheet.appendRow([clientId, layoutJson, now]);
  }

  return jsonResponse({ success: true, updated_at: now });
}


// ════════════════════════════════════════════════════════════════
// ACTION: GET LAYOUT
// Returns the saved canvas JSON for a client_id.
// Returns { layout_json: null } if no layout saved yet.
//
// Sheet: Layouts  [ client_id | layout_json | updated_at ]
// ════════════════════════════════════════════════════════════════
function handleGetLayout(params) {
  const clientId = (params.client_id || '').trim();
  if (!clientId) {
    return jsonResponse({ success: false, error: 'Missing client_id.' });
  }

  const data = getSheet(SHEET_LAYOUTS).getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === clientId) {
      return jsonResponse({
        success:     true,
        layout_json: String(data[i][1]),
        updated_at:  String(data[i][2])
      });
    }
  }

  return jsonResponse({ success: true, layout_json: null });
}


// ════════════════════════════════════════════════════════════════
// UTILITY: SETUP SHEET HEADERS
//
// Run this ONCE from the Apps Script editor after pasting SHEET_ID.
// Creates the three tabs with correct headers and formatting.
// ════════════════════════════════════════════════════════════════
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  function ensureSheet(name, headers) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getRange(1, 1).getValue() === '') {
      const range = sheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#1e293b');
      range.setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  ensureSheet(SHEET_USERS,    ['email', 'password_hash', 'role', 'name', 'client_id']);
  ensureSheet(SHEET_COMMENTS, ['id', 'client_id', 'room_tab', 'author', 'role', 'message', 'timestamp', 'parent_id']);
  ensureSheet(SHEET_LAYOUTS,  ['client_id', 'layout_json', 'updated_at']);

  Logger.log('✅ Sheets set up successfully.');
}


// ════════════════════════════════════════════════════════════════
// UTILITY: ADD A USER MANUALLY
//
// Use from the Apps Script editor to add consultants or clients.
// The password is hashed here using sha256() before storing.
//
// Example usage:
//   addUser('amardeep@vastudraw.com', 'MyPass@123', 'consultant', 'Amardeep Vaze', '');
//   addUser('ravi@gmail.com',         'Ravi@456',   'client',     'Ravi Sharma',   'CLI001');
// ════════════════════════════════════════════════════════════════
function addUser(email, plaintextPassword, role, name, clientId) {
  if (!email || !plaintextPassword || !role || !name) {
    throw new Error('addUser: email, plaintextPassword, role, and name are all required.');
  }
  const hash = sha256(plaintextPassword);
  getSheet(SHEET_USERS).appendRow([
    email.toLowerCase().trim(),
    hash,
    role,
    name,
    clientId || ''
  ]);
  Logger.log('✅ User added: ' + email + ' (' + role + ')');
}


// ════════════════════════════════════════════════════════════════
// UTILITY: SEED TEST USERS  (run once, then delete this function)
// ════════════════════════════════════════════════════════════════
function seedTestUsers() {
  addUser('consultant@vastudraw.com', 'Vastu@2024',  'consultant', 'Amardeep Vaze', '');
  addUser('ravi@example.com',         'Client@123',  'client',     'Ravi Sharma',   'CLI001');
  addUser('priya@example.com',        'Client@456',  'client',     'Priya Mehta',   'CLI002');
  Logger.log('✅ Test users seeded.');
}