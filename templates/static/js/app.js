const state = {
  session: JSON.parse(localStorage.getItem('relay_session') || 'null'),
  socket: null,
  signalSocket: null,
  selected: null,
  selectedGroup: null,
  users: [],
  groups: [],
  renderedMessageIds: new Set()
}


const $ = id => document.getElementById(id)


function initials(name) {
  if (!name) return ''
  return name.slice(0, 2).toUpperCase()
}


function authHeaders() {
  return {
    Authorization: `Bearer ${state.session.access_token}`
  }
}


function setView(isAuthenticated) {
  $('authView').classList.toggle('hidden', isAuthenticated)
  $('appView').classList.toggle('hidden', !isAuthenticated)
}


async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  })

  let data

  try {
    data = await response.json()
  } catch {
    data = {}
  }

  if (!response.ok) {
    throw new Error(
      data.detail || 'Request failed'
    )
  }

  return data
}


function setAuthMode(mode) {
  const signupCard = $('signupCard')
  const loginCard = $('loginCard')
  const signupError = $('signupError')
  const loginError = $('loginError')
  const otpStatus = $('otpStatus')

  if (signupError) signupError.textContent = ''
  if (loginError) loginError.textContent = ''
  if (otpStatus) {
    otpStatus.textContent = ''
    otpStatus.classList.add('hidden')
  }

  if (mode === 'login') {
    if (signupCard) signupCard.classList.add('hidden')
    if (loginCard) {
      loginCard.classList.remove('hidden')
      loginCard.classList.remove('card-animate')
      void loginCard.offsetWidth
      loginCard.classList.add('card-animate')
    }
    const loginEmail = $('loginEmail')
    if (loginEmail) loginEmail.focus()
  } else {
    if (loginCard) loginCard.classList.add('hidden')
    if (signupCard) {
      signupCard.classList.remove('hidden')
      signupCard.classList.remove('card-animate')
      void signupCard.offsetWidth
      signupCard.classList.add('card-animate')
    }
    const signupUsername = $('signupUsername')
    if (signupUsername) signupUsername.focus()
  }
}

let otpCooldownTimer = null

async function sendOtp() {
  const emailInput = $('signupEmail')
  const email = emailInput ? emailInput.value.trim() : ''
  const statusEl = $('otpStatus')
  const errorEl = $('signupError')
  const sendBtn = $('sendOtpBtn')

  if (errorEl) errorEl.textContent = ''
  if (statusEl) {
    statusEl.textContent = ''
    statusEl.classList.add('hidden')
  }

  if (!email || !email.includes('@')) {
    if (errorEl) errorEl.textContent = 'Please enter a valid Gmail / Email address first.'
    if (emailInput) emailInput.focus()
    return
  }

  try {
    if (sendBtn) {
      sendBtn.disabled = true
      sendBtn.textContent = 'Sending...'
    }

    const response = await fetch('/auth/send-otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.detail || 'Failed to send OTP')
    }

    if (statusEl) {
      statusEl.innerHTML = `✉️ Verification email sent to <strong>${email}</strong>! Please check your Gmail/inbox for your 6-digit code.`
      statusEl.className = 'status-msg status-success'
      statusEl.classList.remove('hidden')
    }

    const otpInput = $('signupOtp')
    if (otpInput) {
      otpInput.value = ''
      otpInput.focus()
    }

    // 60-second cooldown
    let cooldown = 60
    if (sendBtn) sendBtn.textContent = `Resend (${cooldown}s)`
    if (otpCooldownTimer) clearInterval(otpCooldownTimer)
    otpCooldownTimer = setInterval(() => {
      cooldown--
      if (cooldown <= 0) {
        clearInterval(otpCooldownTimer)
        if (sendBtn) {
          sendBtn.disabled = false
          sendBtn.textContent = 'Send OTP'
        }
      } else {
        if (sendBtn) sendBtn.textContent = `Resend (${cooldown}s)`
      }
    }, 1000)
  } catch (err) {
    if (sendBtn) {
      sendBtn.disabled = false
      sendBtn.textContent = 'Send OTP'
    }
    if (errorEl) errorEl.textContent = err.message
  }
}

async function handleSignup(event) {
  event.preventDefault()
  const errorEl = $('signupError')
  if (errorEl) errorEl.textContent = ''

  const username = $('signupUsername').value.trim()
  const email = $('signupEmail').value.trim()
  const otp = $('signupOtp').value.trim()
  const password = $('signupPassword').value

  if (!username) {
    if (errorEl) errorEl.textContent = 'Username is required.'
    return
  }
  if (!email) {
    if (errorEl) errorEl.textContent = 'Email is required.'
    return
  }
  if (!otp || otp.length !== 6) {
    if (errorEl) errorEl.textContent = 'Please enter the 6-digit OTP sent to your email.'
    return
  }
  if (password.length < 6) {
    if (errorEl) errorEl.textContent = 'Password must be at least 6 characters.'
    return
  }

  const submitBtn = $('signupSubmitBtn')
  try {
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Creating account...'
    }

    const response = await fetch('/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        email,
        password,
        otp
      })
    })

    const data = await response.json()

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error(data.detail || 'This username or email is already registered.')
      }
      throw new Error(data.detail || 'Sign up failed')
    }

    completeSession(data)
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false
      submitBtn.innerHTML = 'Create account <span>→</span>'
    }
  }
}

async function handleLogin(event) {
  event.preventDefault()
  const errorEl = $('loginError')
  if (errorEl) errorEl.textContent = ''

  const email = $('loginEmail').value.trim()
  const password = $('loginPassword').value

  if (!email) {
    if (errorEl) errorEl.textContent = 'Gmail / Email is required.'
    return
  }
  if (!password) {
    if (errorEl) errorEl.textContent = 'Password is required.'
    return
  }

  const submitBtn = $('loginSubmitBtn')
  try {
    if (submitBtn) {
      submitBtn.disabled = true
      submitBtn.textContent = 'Signing in...'
    }

    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password
      })
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.detail || 'Invalid email or password')
    }

    completeSession(data)
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false
      submitBtn.innerHTML = 'Sign in <span>→</span>'
    }
  }
}

function cleanDisplayName(name) {
  if (!name) return ''
  const trimmed = name.trim()
  return trimmed.includes('@') ? trimmed.split('@')[0] : trimmed
}

function updateProfileUI(user) {
  if (!user) return
  const displayName = cleanDisplayName(user.username)
  if ($('profileName')) {
    $('profileName').textContent = displayName
  }
  if ($('profileInitial')) {
    $('profileInitial').textContent = initials(displayName)
  }
  if ($('profileEmail')) {
    $('profileEmail').textContent = user.email || ''
  }
}

function completeSession(data) {
  state.session = data

  localStorage.setItem(
    'relay_session',
    JSON.stringify(data)
  )

  setView(true)
  updateProfileUI(data)

  initE2EE().catch(console.error)
  connectSignal()
  refreshConversations()
}

function performLogout() {
  state.session = null

  if (state.socket) {
    state.socket.close()
  }

  if (state.signalSocket) {
    state.signalSocket.close()
    state.signalSocket = null
  }

  endCall()
  resetVoiceState()

  e2eeState.sessionCache.clear()
  e2eeState.groupKeys.clear()
  e2eeState.conversationKeys.clear()
  e2eeState.sentCache.clear()
  e2eeState.identity = null
  e2eeState.initialized = false
  if (e2eeState.db) { e2eeState.db.close(); e2eeState.db = null }
  _idb = null

  localStorage.removeItem('relay_session')
  setView(false)
}

$('signupCard')?.addEventListener('submit', handleSignup)
$('loginCard')?.addEventListener('submit', handleLogin)
$('sendOtpBtn')?.addEventListener('click', sendOtp)
$('switchToLoginBtn')?.addEventListener('click', () => setAuthMode('login'))
$('switchToSignupBtn')?.addEventListener('click', () => setAuthMode('signup'))

// Popover Menus for Brand Header and New Chat
const newChatBtn = $('newChatBtn')
const newChatMenu = $('newChatMenu')
const logoutBtn = $('logoutButton')
const brandMenu = $('brandMenu')

function closeAllPopovers() {
  newChatMenu?.classList.add('hidden')
  brandMenu?.classList.add('hidden')
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#newChatBtn') && !e.target.closest('#newChatMenu') &&
      !e.target.closest('#logoutButton') && !e.target.closest('#brandMenu')) {
    closeAllPopovers()
  }
})

if (newChatBtn) {
  newChatBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    brandMenu?.classList.add('hidden')
    newChatMenu?.classList.toggle('hidden')
  })
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    newChatMenu?.classList.add('hidden')
    brandMenu?.classList.toggle('hidden')
  })
}

// Brand Menu Actions
$('brandMenuNewChat')?.addEventListener('click', () => {
  closeAllPopovers()
  const searchInput = $('userSearch')
  if (searchInput) searchInput.focus()
  showToast('🔍 Search for any user to start a conversation', 3000)
})

$('brandMenuNewGroup')?.addEventListener('click', () => {
  closeAllPopovers()
  openCreateGroupModal()
})

$('brandMenuLogout')?.addEventListener('click', () => {
  closeAllPopovers()
  performLogout()
})

// New Chat Menu Actions
$('menuItemNewChat')?.addEventListener('click', () => {
  closeAllPopovers()
  const searchInput = $('userSearch')
  if (searchInput) searchInput.focus()
  showToast('🔍 Search for any user to start a conversation', 3000)
})

$('menuItemNewGroup')?.addEventListener('click', () => {
  closeAllPopovers()
  openCreateGroupModal()
})

/* ============================================================
   END-TO-END ENCRYPTION  –  Double Ratchet + X3DH  (v2)
   Key storage: IndexedDB  (never localStorage)
   Crypto primitives: WebCrypto API only (no external libs)

   Protocol summary
   ────────────────
   • Identity key (IK)       ECDH P-256  long-lived, stored in IndexedDB
   • Signed prekey  (SPK)    ECDH P-256  rotated occasionally, signed by IK
   • One-time prekeys (OPK)  ECDH P-256  single-use, batch-uploaded to server
   • Ephemeral key  (EK)     ECDH P-256  fresh per X3DH session initiation

   X3DH shared-secret derivation (initiator side, Alice → Bob):
     DH1 = ECDH(IK_A, SPK_B)
     DH2 = ECDH(EK_A, IK_B)
     DH3 = ECDH(EK_A, SPK_B)
     DH4 = ECDH(EK_A, OPK_B)   // optional, omitted if no OPK available
     masterSecret = HKDF-SHA256( DH1 ‖ DH2 ‖ DH3 [‖ DH4] )

   Double Ratchet (per message):
     Root key + chain key ratcheted via HKDF on every Diffie-Hellman step.
     Each message uses a unique per-message key derived from the chain key,
     then the chain key advances (KDF chain ratchet).
     A new ECDH ratchet step fires every time we see a new ratchet public key
     from the other side (i.e., every round trip).

   Message envelope (content field stored on server, opaque to server):
     { "e2ee": true, "v": 2,
       "rk":  "<base64 sender ratchet pub key JWK>",   // only on first send
       "ek":  "<base64 ephemeral pub key JWK>",         // X3DH init only
       "opk_id": <number|null>,                          // X3DH OPK used
       "spk_id": <number>,                               // SPK used for X3DH
       "n":   <message index in current sending chain>,
       "pn":  <message count in previous sending chain>,
       "iv":  "<base64 12-byte AES-GCM IV>",
       "ct":  "<base64 AES-256-GCM ciphertext+tag>" }

   Group messages continue to use a shared AES-256-GCM key distributed via
   the Double Ratchet session with the group creator (same as before, but now
   wrapped under a proper DR session key instead of bare static ECDH).
============================================================ */

/* ── Utility helpers ─────────────────────────────────────── */

function buf2b64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function b642buf(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Concatenate multiple ArrayBuffers into one.
function concatBufs(...bufs) {
  const total = bufs.reduce((s, b) => s + b.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const b of bufs) { out.set(new Uint8Array(b), offset); offset += b.byteLength }
  return out.buffer
}

/* ── IndexedDB key store ─────────────────────────────────── */
// DB name per user so multiple accounts on the same browser stay isolated.
// Stores:
//   "identity"    – { id: "keys", ik_pub: JWK, ik_priv: JWK,
//                     spk_pub: JWK, spk_priv: JWK, spk_id: number,
//                     spk_sig: base64, opk_next_id: number }
//   "sessions"    – keyed by peer user-id (number)
//                   value: serialised DoubleRatchetSession
//   "skipped_keys"– keyed by "<peer_id>:<rk_pub_b64>:<n>", value: raw AES key bytes (b64)

let _idb = null   // resolved IDBDatabase instance

function openIDB(userId) {
  if (_idb) return Promise.resolve(_idb)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`relay_e2ee_${userId}`, 2)  // bump version for new store
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('identity'))     db.createObjectStore('identity')
      if (!db.objectStoreNames.contains('sessions'))     db.createObjectStore('sessions')
      if (!db.objectStoreNames.contains('skipped_keys')) db.createObjectStore('skipped_keys')
      // v2: persist decrypted plaintext by message id so history survives refresh
      if (!db.objectStoreNames.contains('plaintexts'))   db.createObjectStore('plaintexts')
    }
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb) }
    req.onerror   = e => reject(e.target.error)
  })
}

function idbGet(db, store, key) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

function idbPut(db, store, key, value) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, 'readwrite')
    const req = tx.objectStore(store).put(value, key)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

function idbDelete(db, store, key) {
  return new Promise((res, rej) => {
    const tx  = db.transaction(store, 'readwrite')
    const req = tx.objectStore(store).delete(key)
    req.onsuccess = () => res()
    req.onerror   = () => rej(req.error)
  })
}

// ── Plaintext persistence helpers ────────────────────────
// Key format:  "dm:<msgId>"    for direct messages
//              "grp:<msgId>"   for group messages
// Stored as a plain string; no sensitive key material here —
// the plaintext is what the user typed/received.

function savePlaintext(db, storeKey, plaintext) {
  return idbPut(db, 'plaintexts', storeKey, plaintext)
}

function getPlaintext(db, storeKey) {
  return idbGet(db, 'plaintexts', storeKey)
}

// Decrypt a history message: IDB cache first, DR decrypt as fallback.
// If DR fails (ratchet moved on), shows a soft lock icon — does NOT corrupt state.
// `keyOrPeerId` is either a numeric peer ID (DM) or a CryptoKey (group).
async function decryptHistoryMessage(content, keyOrPeerId, idbPrefix) {
  if (!isEncryptedMessage(content)) return content

  const db = e2eeState.db
  // 1. IDB plaintext cache — primary source, always works after first view.
  if (db) {
    const cached = await getPlaintext(db, idbPrefix)
    if (cached !== null && cached !== undefined) return cached
  }

  // 2. sentCache — in-memory, works for messages sent this session before refresh.
  if (e2eeState.sentCache.has(content)) {
    const pt = e2eeState.sentCache.get(content)
    if (db) savePlaintext(db, idbPrefix, pt).catch(() => {})
    return pt
  }

  // 3. DR / AES decrypt — only works if session/key is still valid.
  try {
    const plaintext = await decryptMessage(content, keyOrPeerId)
    if (!plaintext.startsWith('🔒') && db) {
      savePlaintext(db, idbPrefix, plaintext).catch(() => {})
    }
    return plaintext
  } catch {
    return '🔒 [Message from a previous session]'
  }
}

/* ── HKDF wrapper ────────────────────────────────────────── */
// Derives `length` bytes from `ikm` (ArrayBuffer) using HKDF-SHA-256.
// `info` is a UTF-8 label string.
async function hkdf(ikm, length, info, salt = null) {
  const keyMat = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const infoEnc = new TextEncoder().encode(info)
  const saltBuf = salt || new Uint8Array(32).buffer // zero salt if not provided
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info: infoEnc },
    keyMat,
    length * 8
  )
}

/* ── ECDH helpers ────────────────────────────────────────── */

// Generate an ECDH key pair.
// Public key: extractable=true  (needs to be exported to JWK for the wire).
// Private key: extractable=false (stored as a CryptoKey in IndexedDB, never exported).
async function generateECDHPair() {
  // Generate extractable first so we can export the public half to JWK.
  const extractable = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
  // Re-import private key as non-extractable — it will live only in IDB/memory.
  const privJwk = await crypto.subtle.exportKey('jwk', extractable.privateKey)
  const nonExtractablePriv = await crypto.subtle.importKey(
    'jwk', privJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,                      // ← non-extractable
    ['deriveKey', 'deriveBits']
  )
  return { publicKey: extractable.publicKey, privateKey: nonExtractablePriv }
}

async function ecdhBits(privKey, pubKey) {
  // Returns raw 32-byte shared secret (P-256 DH output).
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: pubKey },
    privKey,
    256
  )
}

async function importECDHPub(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

async function importECDHPriv(jwkOrKey) {
  // Accept either a JWK object (from wire/old storage) or a CryptoKey directly (from IDB).
  if (jwkOrKey instanceof CryptoKey) return jwkOrKey
  return crypto.subtle.importKey(
    'jwk', jwkOrKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,                      // ← non-extractable
    ['deriveKey', 'deriveBits']
  )
}

/* ── SPK signing (ECDSA P-256 SHA-256 as IK signing key) ── */
async function generateSigningPair() {
  const extractable = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  // Re-import private key as non-extractable.
  const privJwk = await crypto.subtle.exportKey('jwk', extractable.privateKey)
  const nonExtractablePriv = await crypto.subtle.importKey(
    'jwk', privJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,                      // ← non-extractable
    ['sign']
  )
  return { publicKey: extractable.publicKey, privateKey: nonExtractablePriv }
}

async function signSPK(signingPrivKey, spkPubJwk) {
  const data = new TextEncoder().encode(JSON.stringify(spkPubJwk))
  const sig  = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingPrivKey, data)
  return buf2b64(sig)
}

async function verifySPK(signingPubJwk, spkPubJwk, sigB64) {
  try {
    const verifyKey = await crypto.subtle.importKey(
      'jwk', signingPubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']
    )
    const data = new TextEncoder().encode(JSON.stringify(spkPubJwk))
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b642buf(sigB64), data)
  } catch { return false }
}

/* ── AES-256-GCM message encryption ─────────────────────── */
async function aesEncrypt(rawKeyBuf, plaintext) {
  const key = await crypto.subtle.importKey('raw', rawKeyBuf, 'AES-GCM', false, ['encrypt'])
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { iv: buf2b64(iv), ct: buf2b64(ct) }
}

async function aesDecrypt(rawKeyBuf, ivB64, ctB64) {
  const key = await crypto.subtle.importKey('raw', rawKeyBuf, 'AES-GCM', false, ['decrypt'])
  const pt  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b642buf(ivB64) },
    key,
    b642buf(ctB64)
  )
  return new TextDecoder().decode(pt)
}

/* ── Double Ratchet session state ────────────────────────── */
// Stored directly in IndexedDB via structured clone.
// CryptoKey objects are structured-cloneable, so DHs_priv is stored as a
// non-extractable CryptoKey.  DHs_pub and DHr_pub stay as JWK objects
// because they need to be included in message envelopes sent over the wire.
//
// Fields:
//   RK          – root key bytes (b64)
//   CKs         – send chain key bytes (b64)     null until first send ratchet
//   CKr         – recv chain key bytes (b64)     null until first recv ratchet
//   Ns          – message counter (send)
//   Nr          – message counter (recv)
//   PN          – previous send-chain length
//   DHs_pub     – our current ratchet public key (JWK object)
//   DHs_priv    – our current ratchet private key (CryptoKey, non-extractable)
//   DHr_pub     – their latest ratchet public key (JWK object) or null
//   isInitiator – bool

class DoubleRatchetSession {
  constructor(fields) {
    Object.assign(this, {
      RK: null, CKs: null, CKr: null,
      Ns: 0, Nr: 0, PN: 0,
      DHs_pub: null, DHs_priv: null, DHr_pub: null,
      isInitiator: false,
      ...fields,
    })
  }

  // Sessions are stored in IndexedDB via structured clone — CryptoKey objects
  // survive the round-trip natively without needing JSON serialisation.
  forStorage() { return { ...this } }

  static fromStorage(obj) { return new DoubleRatchetSession(obj) }
}

/* ── KDF ratchet steps ───────────────────────────────────── */

// Root-key ratchet (DH step): given RK and Dh output → new RK + new chain key
async function kdfRK(rootKeyB64, dhOut) {
  const rkBuf  = b642buf(rootKeyB64)
  const derived = await hkdf(concatBufs(rkBuf, dhOut), 64, 'WhisperRatchet')
  const newRK  = derived.slice(0, 32)
  const newCK  = derived.slice(32, 64)
  return { newRK: buf2b64(newRK), newCK: buf2b64(newCK) }
}

// Chain-key ratchet: advance CK → (message key bytes, new CK bytes)
async function kdfCK(ckB64) {
  const ck      = b642buf(ckB64)
  const mkBuf   = await hkdf(ck, 32, 'WhisperMessageKey')
  const newCKBuf = await hkdf(ck, 32, 'WhisperChainKey')
  return { mk: mkBuf, newCK: buf2b64(newCKBuf) }
}

/* ── Session persistence (IndexedDB) ────────────────────── */

async function loadSession(db, peerId) {
  const raw = await idbGet(db, 'sessions', peerId)
  return raw ? DoubleRatchetSession.fromStorage(raw) : null
}

async function saveSession(db, peerId, session) {
  await idbPut(db, 'sessions', peerId, session.forStorage())
}

async function saveSkippedKey(db, peerId, rkPubB64, n, mkBuf) {
  const k = `${peerId}:${rkPubB64}:${n}`
  await idbPut(db, 'skipped_keys', k, buf2b64(mkBuf))
}

async function getSkippedKey(db, peerId, rkPubB64, n) {
  const k = `${peerId}:${rkPubB64}:${n}`
  const v = await idbGet(db, 'skipped_keys', k)
  return v ? b642buf(v) : null
}

async function deleteSkippedKey(db, peerId, rkPubB64, n) {
  await idbDelete(db, 'skipped_keys', `${peerId}:${rkPubB64}:${n}`)
}

/* ── E2EE state ──────────────────────────────────────────── */

const e2eeState = {
  db: null,                        // IDBDatabase
  identity: null,                  // loaded identity record
  initialized: false,
  // In-memory caches to avoid redundant IDB reads in the same page session
  sessionCache: new Map(),         // peerId → DoubleRatchetSession
  groupKeys: new Map(),            // groupId → raw AES key bytes (b64)
  // Legacy v1 in-memory map (kept for group-key wrapping compatibility)
  conversationKeys: new Map(),
  // Plaintext cache: ciphertext → plaintext for echoed outgoing messages.
  // The server echoes every sent message back to the sender; we use this
  // to avoid re-decrypting our own ciphertext (which would fail on DR state).
  // Capped at 200 entries to prevent unbounded growth.
  sentCache: new Map(),
}

/* ── Identity key management ─────────────────────────────── */

async function loadOrCreateIdentity(db, userId) {
  let identity = await idbGet(db, 'identity', 'keys')
  if (identity) return identity

  // First boot — generate all key pairs.
  // Private keys are non-extractable (CryptoKey stored directly in IDB).
  // Public keys are exported to JWK for server upload and message envelopes.
  const ikPair    = await generateECDHPair()
  const sigPair   = await generateSigningPair()
  const spkPair   = await generateECDHPair()
  const spkPubJwk = await crypto.subtle.exportKey('jwk', spkPair.publicKey)
  const spkSig    = await signSPK(sigPair.privateKey, spkPubJwk)

  // Generate initial batch of 20 one-time prekeys.
  const opks = []
  for (let i = 0; i < 20; i++) {
    const kp = await generateECDHPair()
    opks.push({
      key_id:  i,
      pub_jwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
      priv:    kp.privateKey,   // ← CryptoKey (non-extractable), stored directly in IDB
    })
  }

  identity = {
    ik_pub:   await crypto.subtle.exportKey('jwk', ikPair.publicKey),
    ik_priv:  ikPair.privateKey,    // CryptoKey, non-extractable
    sig_pub:  await crypto.subtle.exportKey('jwk', sigPair.publicKey),
    sig_priv: sigPair.privateKey,   // CryptoKey, non-extractable
    spk_pub:  spkPubJwk,
    spk_priv: spkPair.privateKey,   // CryptoKey, non-extractable
    spk_id:   0,
    spk_sig:  spkSig,
    opks,
    opk_next_id: 20,
  }

  await idbPut(db, 'identity', 'keys', identity)
  return identity
}

async function uploadPreKeyBundle(identity) {
  const opkBatch = identity.opks.map(opk => ({
    key_id:     opk.key_id,
    public_key: JSON.stringify(opk.pub_jwk),
  }))

  // Pack both the ECDH IK and the ECDSA signing key into identity_key as JSON.
  // The receiver unpacks sig_pub to verify the SPK signature.
  const identityKeyBundle = JSON.stringify({
    ik:  identity.ik_pub,
    sig: identity.sig_pub,
  })

  await request('/api/e2ee/prekey-bundle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity_key:     identityKeyBundle,
      signed_prekey:    JSON.stringify(identity.spk_pub),
      signed_prekey_id: identity.spk_id,
      spk_signature:    identity.spk_sig,
      one_time_prekeys: opkBatch,
    }),
  })
}

// Top up OPKs if the server reports fewer than a threshold.
async function maybeTopUpOPKs(db, identity) {
  try {
    const res = await request('/api/e2ee/opk-count')
    if (res.opk_count >= 10) return   // plenty left

    const newOpks = []
    let nextId = identity.opk_next_id || identity.opks.length
    const needed = 20 - res.opk_count
    for (let i = 0; i < needed; i++) {
      const kp = await generateECDHPair()
      newOpks.push({
        key_id:  nextId++,
        pub_jwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
        priv:    kp.privateKey,   // CryptoKey, non-extractable
      })
    }

    await request('/api/e2ee/one-time-prekeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        one_time_prekeys: newOpks.map(o => ({
          key_id: o.key_id,
          public_key: JSON.stringify(o.pub_jwk),
        })),
      }),
    })

    identity.opks.push(...newOpks)
    identity.opk_next_id = nextId
    await idbPut(db, 'identity', 'keys', identity)
  } catch (err) {
    console.warn('[E2EE] OPK top-up failed:', err)
  }
}

/* ── initE2EE ────────────────────────────────────────────── */

async function initE2EE() {
  if (!state.session?.user_id) return
  if (e2eeState.initialized) return

  const userId = state.session.user_id
  try {
    const db = await openIDB(userId)
    e2eeState.db = db

    let identity = await loadOrCreateIdentity(db, userId)

    // Migration: regenerate if identity is missing sig keys OR if private keys
    // are still stored as JWK strings (pre non-extractable upgrade).
    const privKeysAreJWK = identity.ik_priv && !(identity.ik_priv instanceof CryptoKey)
    if (!identity.sig_pub || !identity.sig_priv || privKeysAreJWK) {
      console.info('[E2EE] Identity needs regeneration (missing sig keys or old JWK format).')
      await idbDelete(db, 'identity', 'keys')
      // Also clear stale sessions derived from the old key material.
      await new Promise((res, rej) => {
        const tx  = db.transaction('sessions', 'readwrite')
        const req = tx.objectStore('sessions').clear()
        req.onsuccess = () => res()
        req.onerror   = () => rej(req.error)
      })
      identity = await loadOrCreateIdentity(db, userId)
    }

    e2eeState.identity = identity

    // Upload bundle (server upserts, safe to call every login).
    await uploadPreKeyBundle(identity).catch(err =>
      console.error('[E2EE] Bundle upload failed:', err)
    )
    console.debug('[E2EE] Bundle uploaded. identity has sig_pub:', !!identity.sig_pub, 'spk_id:', identity.spk_id)

    // Best-effort OPK top-up in background.
    maybeTopUpOPKs(db, identity).catch(() => {})

    e2eeState.initialized = true
    console.info('[E2EE] Initialised with Double Ratchet + IndexedDB.')
  } catch (err) {
    console.error('[E2EE] Init failed:', err)
  }
}

/* ── X3DH session initiation (Alice/initiator) ───────────── */
// Returns a bootstrapped DoubleRatchetSession and the X3DH header fields
// that Alice must include in her first message.

async function x3dhInitiateSession(identity, bundle) {
  // Unpack identity_key — contains both the ECDH IK and the ECDSA signing key.
  const ikBundle  = JSON.parse(bundle.identity_key)
  const ikPubJwk  = ikBundle.ik  ?? ikBundle   // backwards compat: plain JWK if old format
  const sigPubJwk = ikBundle.sig ?? ikBundle   // same fallback

  const spkPubJwk = JSON.parse(bundle.signed_prekey)

  // Verify the SPK signature using the dedicated signing key.
  const valid = await verifySPK(sigPubJwk, spkPubJwk, bundle.spk_signature)
  console.debug('[E2EE] SPK verification result:', valid, 'sigPubJwk.kty:', sigPubJwk?.kty, 'crv:', sigPubJwk?.crv)
  if (!valid) {
    throw new Error('[E2EE] SPK signature verification failed. Possible server tampering.')
  }

  // Import Bob's ECDH public keys.
  const IK_B   = await importECDHPub(ikPubJwk)
  const SPK_B  = await importECDHPub(spkPubJwk)
  const OPK_B  = bundle.one_time_prekey
    ? await importECDHPub(JSON.parse(bundle.one_time_prekey.public_key))
    : null

  // Alice's own IK and a fresh ephemeral key.
  const IK_A_priv = await importECDHPriv(identity.ik_priv)
  const EK_A      = await generateECDHPair()
  const EK_A_priv = EK_A.privateKey
  const EK_A_pub  = EK_A.publicKey

  // X3DH four DH computations.
  const DH1 = await ecdhBits(IK_A_priv, SPK_B)   // IK_A ↔ SPK_B
  const DH2 = await ecdhBits(EK_A_priv, IK_B)    // EK_A ↔ IK_B
  const DH3 = await ecdhBits(EK_A_priv, SPK_B)   // EK_A ↔ SPK_B
  const dhs = OPK_B
    ? [DH1, DH2, DH3, await ecdhBits(EK_A_priv, OPK_B)]
    : [DH1, DH2, DH3]
  const masterSecret = await hkdf(concatBufs(...dhs), 32, 'X3DHMasterSecret')

  // Initialise Double Ratchet with Bob's SPK as the first remote ratchet key.
  const DHs = await generateECDHPair()   // Alice's initial DR ratchet key pair
  const dhOut = await ecdhBits(DHs.privateKey, SPK_B)
  const { newRK, newCK } = await kdfRK(buf2b64(masterSecret), dhOut)

  const session = new DoubleRatchetSession({
    RK:          newRK,
    CKs:         newCK,
    CKr:         null,
    Ns:          0,
    Nr:          0,
    PN:          0,
    DHs_pub:     await crypto.subtle.exportKey('jwk', DHs.publicKey),
    DHs_priv:    DHs.privateKey,   // CryptoKey (non-extractable), stored in IDB directly
    DHr_pub:     identity.spk_pub,   // Bob's SPK used as initial remote ratchet key
    isInitiator: true,
  })

  const ekPubJwk = await crypto.subtle.exportKey('jwk', EK_A_pub)
  const x3dhHeader = {
    ek:     JSON.stringify(ekPubJwk),
    opk_id: bundle.one_time_prekey?.key_id ?? null,
    spk_id: bundle.signed_prekey_id,
  }

  return { session, x3dhHeader }
}

/* ── X3DH session response (Bob/receiver) ───────────────── */
// Called when Bob receives the first message from Alice.
// Returns a bootstrapped DoubleRatchetSession seeded from the X3DH header.

async function x3dhRespondSession(identity, senderIKBundle, ekPubJwk, opkId, spkId) {
  // Check that the SPK ID matches what we have stored.
  if (spkId !== identity.spk_id) {
    throw new Error(`[E2EE] SPK id mismatch: expected ${identity.spk_id}, got ${spkId}`)
  }

  // Unpack Alice's identity key bundle — extract the ECDH IK for DH.
  const ikBundle  = JSON.parse(senderIKBundle)
  const ikPubJwk  = ikBundle.ik ?? ikBundle   // backwards compat

  // Import Alice's keys.
  const IK_A  = await importECDHPub(ikPubJwk)
  const EK_A  = await importECDHPub(JSON.parse(ekPubJwk))

  // Our own keys.
  const IK_B_priv  = await importECDHPriv(identity.ik_priv)
  const SPK_B_priv = await importECDHPriv(identity.spk_priv)

  // Optional OPK.
  let OPK_B_priv = null
  if (opkId !== null && opkId !== undefined) {
    const opkEntry = identity.opks.find(o => o.key_id === opkId)
    if (opkEntry) OPK_B_priv = await importECDHPriv(opkEntry.priv)
  }

  // Mirror of Alice's DH computations (roles swapped).
  const DH1 = await ecdhBits(SPK_B_priv, IK_A)   // SPK_B ↔ IK_A
  const DH2 = await ecdhBits(IK_B_priv,  EK_A)   // IK_B  ↔ EK_A
  const DH3 = await ecdhBits(SPK_B_priv, EK_A)   // SPK_B ↔ EK_A
  const dhs = OPK_B_priv
    ? [DH1, DH2, DH3, await ecdhBits(OPK_B_priv, EK_A)]
    : [DH1, DH2, DH3]
  const masterSecret = await hkdf(concatBufs(...dhs), 32, 'X3DHMasterSecret')

  // Initialise DR: Bob starts without a send chain; Alice's first ratchet key
  // will arrive in the message header and trigger the first DH ratchet step.
  const session = new DoubleRatchetSession({
    RK:          buf2b64(masterSecret),
    CKs:         null,
    CKr:         null,
    Ns:          0,
    Nr:          0,
    PN:          0,
    DHs_pub:     identity.spk_pub,
    DHs_priv:    identity.spk_priv,
    DHr_pub:     null,
    isInitiator: false,
  })

  return session
}

/* ── Double Ratchet encrypt ──────────────────────────────── */

async function drEncrypt(db, peerId, session, plaintext) {
  // Advance the send chain to derive the next message key.
  if (!session.CKs) {
    // First message: perform a DH ratchet step to establish CKs.
    if (!session.DHr_pub) throw new Error('[E2EE] No remote ratchet key available')
    const DHr    = await importECDHPub(session.DHr_pub)
    const DHs    = await generateECDHPair()
    const dhOut  = await ecdhBits(
      await importECDHPriv(session.DHs_priv), DHr
    )
    const { newRK, newCK } = await kdfRK(session.RK, dhOut)
    session.PN    = session.Ns
    session.Ns    = 0
    session.RK    = newRK
    session.CKs   = newCK
    session.DHs_pub  = await crypto.subtle.exportKey('jwk', DHs.publicKey)
    session.DHs_priv = DHs.privateKey   // CryptoKey (non-extractable)
  }

  const { mk, newCK } = await kdfCK(session.CKs)
  session.CKs = newCK

  const { iv, ct } = await aesEncrypt(mk, plaintext)
  const header = {
    rk:  JSON.stringify(session.DHs_pub),
    n:   session.Ns,
    pn:  session.PN,
    iv,
    ct,
  }

  session.Ns++
  await saveSession(db, peerId, session)
  return header
}

/* ── Double Ratchet decrypt ──────────────────────────────── */

// Max skipped messages per ratchet step to prevent DoS.
const MAX_SKIP = 500

async function drSkipKeys(db, peerId, session, until) {
  if (session.Nr + MAX_SKIP < until) {
    throw new Error('[E2EE] Too many skipped messages — possible attack')
  }
  while (session.Nr < until) {
    if (!session.CKr) break
    const { mk, newCK } = await kdfCK(session.CKr)
    await saveSkippedKey(db, peerId, JSON.stringify(session.DHr_pub), session.Nr, mk)
    session.CKr = newCK
    session.Nr++
  }
}

async function drDecrypt(db, identity, peerId, session, envelope) {
  const { rk: rkPubStr, n, pn, iv, ct } = envelope

  // 1. Check skipped-message cache first.
  if (rkPubStr) {
    const skipped = await getSkippedKey(db, peerId, rkPubStr, n)
    if (skipped) {
      await deleteSkippedKey(db, peerId, rkPubStr, n)
      return aesDecrypt(skipped, iv, ct)
    }
  }

  // 2. If the header ratchet key is different from what we have → DH ratchet step.
  const newDHr = rkPubStr ? JSON.parse(rkPubStr) : session.DHr_pub
  const dhPubChanged = rkPubStr && JSON.stringify(newDHr) !== JSON.stringify(session.DHr_pub)

  if (dhPubChanged) {
    // Skip any messages in the previous receive chain we haven't seen yet.
    await drSkipKeys(db, peerId, session, pn)

    // DH ratchet step (receive side).
    const newDHrKey  = await importECDHPub(newDHr)
    const dhOut      = await ecdhBits(await importECDHPriv(session.DHs_priv), newDHrKey)
    const { newRK, newCK: newCKr } = await kdfRK(session.RK, dhOut)

    session.PN    = session.Ns
    session.Ns    = 0
    session.Nr    = 0
    session.RK    = newRK
    session.CKr   = newCKr
    session.DHr_pub = newDHr

    // Generate new sending ratchet key pair for our next message.
    const newDHs      = await generateECDHPair()
    const dhOut2      = await ecdhBits(newDHs.privateKey, newDHrKey)
    const { newRK: newRK2, newCK: newCKs } = await kdfRK(newRK, dhOut2)
    session.RK    = newRK2
    session.CKs   = newCKs
    session.DHs_pub  = await crypto.subtle.exportKey('jwk', newDHs.publicKey)
    session.DHs_priv = newDHs.privateKey   // CryptoKey (non-extractable)
  }

  // 3. Skip messages in the current receive chain if needed.
  await drSkipKeys(db, peerId, session, n)

  // 4. Derive the message key for message n.
  if (!session.CKr) throw new Error('[E2EE] Receive chain not initialised')
  const { mk, newCK } = await kdfCK(session.CKr)
  session.CKr = newCK
  session.Nr  = n + 1

  await saveSession(db, peerId, session)
  return aesDecrypt(mk, iv, ct)
}

/* ── Public: get/create DR session for a peer ────────────── */

async function getDRSession(peerId) {
  peerId = Number(peerId)
  if (!e2eeState.initialized) await initE2EE()
  const db = e2eeState.db

  // Return cached session if available.
  if (e2eeState.sessionCache.has(peerId)) {
    return { session: e2eeState.sessionCache.get(peerId), x3dhHeader: null }
  }

  let session = await loadSession(db, peerId)
  if (session) {
    e2eeState.sessionCache.set(peerId, session)
    return { session, x3dhHeader: null }
  }

  // No session yet — initiate X3DH.
  let bundle
  try {
    bundle = await request(`/api/e2ee/prekey-bundle/${peerId}`)
    console.debug('[E2EE] Fetched bundle for peer', peerId, JSON.stringify(bundle).slice(0, 120))
  } catch (err) {
    console.error(`[E2EE] Bundle fetch failed for user ${peerId}:`, err)
    return { session: null, x3dhHeader: null }
  }

  if (!bundle.signed_prekey) {
    console.warn(`[E2EE] User ${peerId} bundle missing signed_prekey:`, bundle)
    return { session: null, x3dhHeader: null }
  }
  let newSession, x3dhHeader
  try {
    const result = await x3dhInitiateSession(e2eeState.identity, bundle)
    newSession  = result.session
    x3dhHeader  = result.x3dhHeader
  } catch (err) {
    console.error(`[E2EE] x3dhInitiateSession failed for peer ${peerId}:`, err)
    return { session: null, x3dhHeader: null }
  }

  await saveSession(db, peerId, newSession)
  e2eeState.sessionCache.set(peerId, newSession)
  return { session: newSession, x3dhHeader }
}

/* ── Public: encryptMessage ──────────────────────────────── */

async function encryptMessage(text, peerIdOrKey) {
  // peerIdOrKey is a numeric peer ID for DR, or an AES CryptoKey for groups (legacy API).
  if (!text) return text

  // Group key path (CryptoKey object passed in).
  if (peerIdOrKey instanceof CryptoKey) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        peerIdOrKey,
        new TextEncoder().encode(text)
      )
      return JSON.stringify({ e2ee: true, v: 1, iv: buf2b64(iv), data: buf2b64(ct) })
    } catch (err) {
      console.error('[E2EE] Group encrypt failed:', err)
      return text
    }
  }

  // Direct message path — Double Ratchet.
  const peerId = Number(peerIdOrKey)
  try {
    const { session, x3dhHeader } = await getDRSession(peerId)
    if (!session) {
      console.warn(`[E2EE] No DR session for peer ${peerId} — peer has no prekey bundle yet.`)
      showToast('🔒 The other person hasn\'t opened the app yet — their encryption keys aren\'t ready. Try again once they\'re online.', 6000)
      return null   // caller MUST check for null and block send
    }

    const envelope = await drEncrypt(e2eeState.db, peerId, session, text)
    const payload = { e2ee: true, v: 2, ...envelope }
    if (x3dhHeader) {
      // Attach X3DH init fields so the receiver can bootstrap their session.
      payload.ek     = x3dhHeader.ek
      payload.opk_id = x3dhHeader.opk_id
      payload.spk_id = x3dhHeader.spk_id
      // Send the full identity key bundle (ECDH IK + ECDSA sig key) so Bob
      // can both verify the SPK and perform the DH computations.
      payload.ik = JSON.stringify({ ik: e2eeState.identity.ik_pub, sig: e2eeState.identity.sig_pub })
    }
    const ciphertext = JSON.stringify(payload)

    // Cache plaintext so when the server echoes the message back to us we
    // can display it without attempting to re-decrypt our own ciphertext.
    if (e2eeState.sentCache.size >= 200) {
      const firstKey = e2eeState.sentCache.keys().next().value
      e2eeState.sentCache.delete(firstKey)
    }
    e2eeState.sentCache.set(ciphertext, text)

    return ciphertext
  } catch (err) {
    console.error('[E2EE] DR encrypt failed:', err)
    return text
  }
}

/* ── Public: decryptMessage ──────────────────────────────── */

function isEncryptedMessage(str) {
  if (typeof str !== 'string') return false
  const t = str.trim()
  return t.startsWith('{"e2ee":true') || t.startsWith('{"e2ee": true')
}

async function decryptMessage(content, peerIdOrKey) {
  if (!isEncryptedMessage(content)) return content   // legacy plain text

  // Check sent-cache first: if we encrypted this exact ciphertext ourselves,
  // return the original plaintext directly without touching the DR state.
  if (e2eeState.sentCache.has(content)) {
    console.debug('[E2EE] decryptMessage: hit sentCache, returning plaintext')
    return e2eeState.sentCache.get(content)
  }
  console.debug('[E2EE] decryptMessage: sentCache miss, cacheSize=', e2eeState.sentCache.size, 'peerIdOrKey=', peerIdOrKey)

  let parsed
  try { parsed = JSON.parse(content) } catch { return content }

  console.debug('[E2EE] decryptMessage: v=', parsed.v, 'peerIdOrKey=', peerIdOrKey, 'isX3DH=', !!(parsed.ek && parsed.ik))

  // ── v1 (legacy AES-GCM, group messages or old direct) ──
  if (parsed.v === 1) {
    if (!(peerIdOrKey instanceof CryptoKey)) {
      // Attempt to get a group CryptoKey from the cache if none passed.
      return '🔒 [Encrypted – legacy format]'
    }
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b642buf(parsed.iv) },
        peerIdOrKey,
        b642buf(parsed.data)
      )
      return new TextDecoder().decode(pt)
    } catch {
      return '🔒 [Encrypted message]'
    }
  }

  // ── v2 Double Ratchet ──
  if (parsed.v === 2) {
    const peerId = Number(peerIdOrKey instanceof CryptoKey ? 0 : peerIdOrKey)
    if (!peerId) return '🔒 [Encrypted – no peer id]'
    if (!e2eeState.initialized) await initE2EE()

    const db = e2eeState.db
    let session = await loadSession(db, peerId)

    // If no session and this is an X3DH init message, bootstrap Bob's side.
    if (!session && parsed.ek && parsed.ik) {
      try {
        session = await x3dhRespondSession(
          e2eeState.identity,
          parsed.ik,
          parsed.ek,
          parsed.opk_id ?? null,
          parsed.spk_id ?? e2eeState.identity.spk_id
        )
        await saveSession(db, peerId, session)
        e2eeState.sessionCache.set(peerId, session)
      } catch (err) {
        console.warn('[E2EE] X3DH respond failed:', err)
        return '🔒 [Session init failed]'
      }
    }

    if (!session) return '🔒 [No session – key pending]'

    try {
      const plaintext = await drDecrypt(db, e2eeState.identity, peerId, session, parsed)
      // Keep the in-memory cache up to date.
      e2eeState.sessionCache.set(peerId, session)
      return plaintext
    } catch (err) {
      console.warn('[E2EE] DR decrypt failed:', err)
      return '🔒 [Encrypted message]'
    }
  }

  return '🔒 [Unknown encryption version]'
}

/* ── Direct conversation key (backward-compat wrapper) ──── */
// Previously callers got an AES CryptoKey; now they pass the peer's numeric ID
// directly to encryptMessage/decryptMessage. This wrapper keeps old call sites
// working while returning the peerId as the "key" token.

async function getDirectConversationKey(otherUserId /*, otherUser */) {
  if (!e2eeState.initialized) await initE2EE()
  // Return the numeric id — encryptMessage/decryptMessage handle it.
  return Number(otherUserId)
}

/* ── Group conversation key (AES-GCM, wrapped via DR) ────── */

async function generateKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

async function getGroupConversationKey(group) {
  const groupId = Number(group.id)
  if (e2eeState.groupKeys.has(groupId)) {
    // Re-import from cached raw bytes.
    const rawB64 = e2eeState.groupKeys.get(groupId)
    return crypto.subtle.importKey('raw', b642buf(rawB64), 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  if (!e2eeState.initialized) await initE2EE()

  // Try loading from server (encrypted under our DR session with creator).
  try {
    const res = await request(`/api/e2ee/group-key/${groupId}`)
    if (res && res.encrypted_key) {
      // The stored encrypted_key is a v2 DR envelope produced when the creator
      // distributed the group key; decrypt it using the DR session.
      const creatorId = Number(group.created_by)
      const plainB64  = await decryptMessage(res.encrypted_key, creatorId)
      if (!plainB64.startsWith('🔒')) {
        const groupKey = await crypto.subtle.importKey(
          'raw', b642buf(plainB64), 'AES-GCM', false, ['encrypt', 'decrypt']
        )
        e2eeState.groupKeys.set(groupId, plainB64)
        return groupKey
      }
    }
  } catch (err) {
    console.warn('[E2EE] Could not load group key from server:', err)
  }

  // Generate a fresh AES-256-GCM group key and distribute to each member
  // by encrypting it under their individual Double Ratchet session.
  try {
    const groupKey  = await generateKey()
    const rawBuf    = await crypto.subtle.exportKey('raw', groupKey)
    const rawB64    = buf2b64(rawBuf)

    const keysMap = {}
    let distributed = 0
    if (group.members?.length) {
      for (const member of group.members) {
        try {
          const wrapped = await encryptMessage(rawB64, Number(member.id))
          if (wrapped && wrapped !== rawB64) {
            keysMap[member.id] = wrapped
            distributed++
          }
        } catch { /* skip member with no bundle yet */ }
      }
      if (distributed > 0) {
        await request(`/api/e2ee/group-keys/${groupId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: keysMap }),
        }).catch(err => console.warn('[E2EE] Failed to store group keys:', err))
      }
    }

    e2eeState.groupKeys.set(groupId, rawB64)
    return groupKey
  } catch (err) {
    console.error('[E2EE] Group key generation failed:', err)
    return null
  }
}

/* ── E2EE banner ─────────────────────────────────────────── */

function appendE2EEBanner(isGroup = false) {
  const existing = document.querySelector('.e2ee-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.className = 'e2ee-banner'
  banner.innerHTML = isGroup
    ? '<span class="e2ee-banner-icon">🔒</span><span>Messages are end-to-end encrypted with Double Ratchet (Signal Protocol). Only group members can read them.</span>'
    : '<span class="e2ee-banner-icon">🔒</span><span>Messages are end-to-end encrypted with Double Ratchet (Signal Protocol). No one else can read them.</span>'
  $('messages').appendChild(banner)
}

/* ============================================================
   USERS & GROUPS
============================================================ */

async function loadUsers() {
  const search = encodeURIComponent($('userSearch').value.trim())
  state.users = await request(`/api/users?search=${search}`)
}

async function loadGroups() {
  if (!state.session) return
  try {
    state.groups = await request('/api/groups')
  } catch (err) {
    console.warn('Failed to load groups:', err)
    state.groups = []
  }
}

async function refreshConversations() {
  await Promise.all([loadUsers(), loadGroups()])
  renderUsers()
}

function renderUsers() {
  const list = $('userList')
  list.innerHTML = ''

  const searchTerm = $('userSearch').value.trim().toLowerCase()

  // 1. Render groups matching search
  const filteredGroups = state.groups.filter(g =>
    !searchTerm || g.name.toLowerCase().includes(searchTerm)
  )

  filteredGroups.forEach(group => {
    const button = document.createElement('button')
    button.className = `user-row ${state.selectedGroup?.id === group.id ? 'active' : ''}`

    const avatar = document.createElement('span')
    avatar.className = 'avatar group-avatar-icon'
    avatar.textContent = '👥'

    const details = document.createElement('span')
    const name = document.createElement('strong')
    name.innerHTML = `${group.name} <span class="group-badge">Group</span>`

    const subtitle = document.createElement('small')
    subtitle.textContent = `${group.members.length} members`

    details.append(name, subtitle)
    button.append(avatar, details)

    button.addEventListener('click', () => openGroupConversation(group))
    list.appendChild(button)
  })

  // 2. Render direct users
  state.users.forEach(user => {
    const button = document.createElement('button')
    button.className = `user-row ${state.selected?.id === user.id ? 'active' : ''}`

    const avatar = document.createElement('span')
    avatar.className = 'avatar'
    avatar.textContent = initials(user.username)

    const details = document.createElement('span')
    const name = document.createElement('strong')
    name.textContent = user.username

    const subtitle = document.createElement('small')
    subtitle.textContent = 'Direct message'

    details.append(name, subtitle)
    button.append(avatar, details)

    button.addEventListener('click', () => openConversation(user))
    list.appendChild(button)
  })

  if (!filteredGroups.length && !state.users.length) {
    list.innerHTML = '<p class="empty">No conversations found.</p>'
  }
}

$('userSearch').addEventListener('input', () => {
  loadUsers().then(renderUsers).catch(() => {})
})

/* ============================================================
   CREATE GROUP MODAL (WhatsApp-style)
============================================================ */

let cgSelectedUsers = new Set()

function openCreateGroupModal() {
  $('createGroupModal')?.classList.remove('hidden')
  const nameInput = $('groupNameInput')
  if (nameInput) nameInput.value = ''
  const searchInput = $('groupMemberSearch')
  if (searchInput) searchInput.value = ''
  cgSelectedUsers.clear()
  renderGroupMemberSelectionList('')
  setTimeout(() => nameInput?.focus(), 100)
}

function renderGroupMemberSelectionList(query = '') {
  const container = $('groupMemberList')
  if (!container) return
  container.innerHTML = ''
  const q = query.trim().toLowerCase()
  const list = state.users.filter(u => u.id !== state.session?.id && (!q || u.username.toLowerCase().includes(q)))

  if (list.length === 0) {
    container.innerHTML = '<p class="empty" style="padding:14px;font-size:13px;text-align:center;">No other users found</p>'
    updateCreateGroupCounter()
    return
  }

  list.forEach(user => {
    const isSelected = cgSelectedUsers.has(user.id)
    const row = document.createElement('div')
    row.className = `gc-user-item ${isSelected ? 'selected' : ''}`

    const av = document.createElement('div')
    av.className = 'person-avatar mini'
    av.textContent = initials(user.username)

    const name = document.createElement('span')
    name.className = 'gc-user-name'
    name.textContent = user.username

    const chk = document.createElement('span')
    chk.className = 'gc-user-check'
    chk.textContent = isSelected ? '✓' : ''

    row.append(av, name, chk)

    row.addEventListener('click', () => {
      if (cgSelectedUsers.has(user.id)) {
        cgSelectedUsers.delete(user.id)
      } else {
        cgSelectedUsers.add(user.id)
      }
      renderGroupMemberSelectionList($('groupMemberSearch').value)
    })

    container.appendChild(row)
  })

  updateCreateGroupCounter()
}

function updateCreateGroupCounter() {
  const countEl = $('groupSelectedCount')
  if (countEl) {
    countEl.textContent = `(${cgSelectedUsers.size} selected)`
  }
}

$('groupMemberSearch')?.addEventListener('input', (e) => {
  renderGroupMemberSelectionList(e.target.value)
})

$('createGroupCancelBtn')?.addEventListener('click', () => {
  $('createGroupModal')?.classList.add('hidden')
})

$('createGroupSubmitBtn')?.addEventListener('click', async () => {
  const nameInput = $('groupNameInput')
  const name = nameInput ? nameInput.value.trim() : ''
  if (!name) {
    showToast('⚠️ Please enter a group name', 3000)
    nameInput?.focus()
    return
  }

  if (cgSelectedUsers.size === 0) {
    showToast('⚠️ Please select at least 1 member for the group', 3000)
    return
  }

  try {
    const member_ids = Array.from(cgSelectedUsers)
    const newGroup = await request('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, member_ids })
    })

    $('createGroupModal')?.classList.add('hidden')
    showToast(`✅ Created group "${newGroup.name}"!`, 3500)
    await refreshConversations()
    openGroupConversation(newGroup)
  } catch (err) {
    showToast(`❌ Failed to create group: ${err.message}`, 4000)
  }
})


/* ============================================================
   CONVERSATION
============================================================ */

async function openConversation(user) {
  if (state.socket) {
    state.socket.close()
  }

  // Clear search field after selecting a user to restore active conversations view
  if ($('userSearch').value) {
    $('userSearch').value = ''
    loadUsers().catch(() => { })
  }

  // Clear search field after selecting a user to restore active conversations view
  if ($('userSearch').value) {
    $('userSearch').value = ''
    refreshConversations().catch(() => {})
  }

  state.selected = user
  state.selectedGroup = null

  renderUsers()

  $('emptyConversation').classList.add('hidden')
  $('activeConversation').classList.remove('hidden')

  $('conversationName').textContent = user.username
  $('conversationAvatar').textContent = initials(user.username)
  $('connectionStatus').textContent = 'Loading history...'

  const voiceBtn = document.querySelector('[data-voice-call]')
  if (voiceBtn) voiceBtn.style.display = ''

  $('messages').innerHTML = ''
  state.renderedMessageIds.clear()

  appendE2EEBanner(false)

  try {
    const history = await request(`/api/messages/${user.id}`)
    for (const msg of history) {
      msg.content = await decryptHistoryMessage(msg.content, user.id, `dm:${msg.id}`)
      renderMessage(msg)
    }
    connect(user.id)
  } catch (error) {
    $('connectionStatus').textContent = error.message
  }
}

async function openGroupConversation(group) {
  if (state.socket) {
    state.socket.close()
  }

  if ($('userSearch').value) {
    $('userSearch').value = ''
    refreshConversations().catch(() => {})
  }

  state.selected = null
  state.selectedGroup = group

  renderUsers()

  $('emptyConversation').classList.add('hidden')
  $('activeConversation').classList.remove('hidden')

  $('conversationName').textContent = group.name
  $('conversationAvatar').textContent = '👥'

  const memberNames = group.members.map(m => m.username).join(', ')
  $('connectionStatus').textContent = `${group.members.length} members: ${memberNames}`

  // For groups, hide the 1-on-1 voice call button
  const voiceBtn = document.querySelector('[data-voice-call]')
  if (voiceBtn) voiceBtn.style.display = 'none'

  $('messages').innerHTML = ''
  state.renderedMessageIds.clear()

  appendE2EEBanner(true)

  try {
    const history = await request(`/api/groups/${group.id}/messages`)
    for (const msg of history) {
      msg.content = await decryptHistoryMessage(msg.content, group.created_by, `grp:${msg.id}`)
      renderMessage(msg)
    }
    connectGroup(group.id)
  } catch (error) {
    $('connectionStatus').textContent = error.message
  }
}

function connectGroup(groupId) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  state.socket = new WebSocket(
    `${protocol}://${location.host}/ws/group/${groupId}?token=${state.session.access_token}`
  )

  state.socket.onopen = () => {
    $('connectionDot').className = 'live-dot online'
    const memberNames = state.selectedGroup?.members.map(m => m.username).join(', ') || ''
    $('connectionStatus').textContent = `${state.selectedGroup?.members.length || 0} members: ${memberNames}`
    $('messageInput').focus()
  }

  state.socket.onmessage = async event => {
    const data = JSON.parse(event.data)
    if (await handleCallSignal(data)) {
      return
    }

    if (data.type === 'group_message' && state.selectedGroup && data.group_id === state.selectedGroup.id) {
      const key = await getGroupConversationKey(state.selectedGroup)
      const plaintext = await decryptMessage(data.content, key)
      // Persist so history survives page refresh.
      if (e2eeState.db && data.id) {
        savePlaintext(e2eeState.db, `grp:${data.id}`, plaintext).catch(() => {})
      }
      data.content = plaintext
      renderMessage(data)
    }

    if (data.type === 'error') {
      showToast(data.message, 3000)
    }
  }

  state.socket.onclose = () => {
    $('connectionDot').className = 'live-dot offline'
    if (state.selectedGroup && state.selectedGroup.id === groupId) {
      $('connectionStatus').textContent = 'Reconnecting…'
      setTimeout(() => {
        if (state.selectedGroup && state.selectedGroup.id === groupId) {
          connectGroup(groupId)
        }
      }, 1500)
    }
  }
}

function connect(receiverId) {

  const protocol =
    location.protocol === 'https:'
      ? 'wss'
      : 'ws'

  state.socket =
    new WebSocket(
      `${protocol}://${location.host}/ws/${receiverId}?token=${state.session.access_token}`
    )

  state.socket.onopen =
    () => {

      $('connectionStatus').textContent =
        'Live now'

      $('messageInput').focus()
    }


  state.socket.onmessage = async event => {

    const data = JSON.parse(event.data)

    if (await handleCallSignal(data)) {
      return
    }

    /* ── CHAT (existing code) ── */

    if (
      data.type === 'message' &&
      (
        data.sender_id === state.selected.id ||
        data.receiver_id === state.selected.id
      )
    ) {
      // Determine the peer ID for decryption
      // If I sent the message, decrypt using receiver's ID as peer
      // If they sent it, decrypt using sender's ID as peer
      const myUserId = state.session.user_id
      const peerId = (data.sender_id === myUserId) ? data.receiver_id : data.sender_id
      
      const key = await getDirectConversationKey(peerId, state.selected)
      const plaintext = await decryptMessage(data.content, key)
      // Persist so history survives page refresh.
      if (e2eeState.db && data.id) {
        savePlaintext(e2eeState.db, `dm:${data.id}`, plaintext).catch(() => {})
      }
      data.content = plaintext
      renderMessage(data)
    }

    if (data.type === 'error') {

      $('connectionStatus').textContent =
        data.message
    }
  }


  state.socket.onclose =
    () => {

      if (state.selected) {

        $('connectionStatus').textContent =
          'Offline'
      }
    }
}


function renderMessage(message) {

  if (
    state.renderedMessageIds.has(
      message.id
    )
  ) {
    return
  }

  state.renderedMessageIds.add(
    message.id
  )

  const mine =
    message.sender_id ===
    state.session.user_id

  const article =
    document.createElement('article')

  article.className =
    `message ${mine ? 'mine' : ''}`

  const date =
    new Date(
      message.created_at
    ).toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    )

  const senderName = message.sender_username || (state.selected?.username) || 'User'
  const peerInitials = initials(senderName)
  const isGroup = Boolean(state.selectedGroup)

  article.innerHTML = mine
    ? `<div class="bubble-row">
         <div class="bubble"></div>
       </div>
       <time>${date} <span class="delivered-tick" title="Delivered">✓✓</span></time>`
    : `<div class="bubble-row">
         <div class="person-avatar mini">${peerInitials}</div>
         <div style="display:flex; flex-direction:column; gap:2px; max-width:85%;">
           ${isGroup ? `<span class="group-msg-sender">${senderName}</span>` : ''}
           <div class="bubble"></div>
         </div>
       </div>
       <time>${date}</time>`

  article
    .querySelector('.bubble')
    .textContent =
    message.content

  const msgContainer = $('messages')
  msgContainer.appendChild(article)
  msgContainer.scrollTo({
    top: msgContainer.scrollHeight,
    behavior: 'smooth'
  })
}


$('messageForm').addEventListener(
  'submit',
  async event => {

    event.preventDefault()

    const input =
      $('messageInput')

    const content =
      input.value.trim()

    if (
      !content ||
      !state.socket ||
      state.socket.readyState !==
      WebSocket.OPEN
    ) {
      return
    }

    // Derive encryption key — this MUST succeed before we send anything.
    // If the peer hasn't uploaded their ECDH public key yet, we block send
    // and show a message rather than silently sending plaintext.
    let encryptedContent
    try {
      let key = null
      if (state.selectedGroup) {
        key = await getGroupConversationKey(state.selectedGroup)
      } else if (state.selected) {
        key = await getDirectConversationKey(state.selected.id, state.selected)
      }

      if (key === null || key === undefined) {
        showToast('🔒 Waiting for peer\'s encryption key — message not sent. Ask them to open the app.', 5000)
        return // Do NOT send plaintext. Ever.
      }

      encryptedContent = await encryptMessage(content, key)

      // encryptMessage returns null when the peer has no prekey bundle yet.
      // The toast was already shown inside encryptMessage — just abort here.
      if (encryptedContent === null) {
        return // NEVER send plaintext
      }
    } catch (err) {
      console.error('[E2EE] Send encryption failed:', err)
      showToast('❌ Encryption error — message not sent.', 4000)
      return
    }

    input.value = ''

    state.socket.send(
      JSON.stringify({
        content: encryptedContent
      })
    )
  }
)



/* ============================================================
   VOICE ASSISTANT STATE
============================================================ */

const voice = {

  state: 'idle',

  action: 'send_message',

  callType: 'unspecified',

  selectedUser: null,

  pendingMessage: null,

  searchResults: [],

  originalCommand: null,

  receiverName: null,

  awaitingUserSelection: false,

  awaitingConfirmation: false,

  awaitingCallSelection: false
}


/*
States:

idle
waiting_for_user
waiting_for_message
waiting_for_confirmation
sending
*/


/* ============================================================
   TTS
============================================================ */

function playTtsAudio(b64) {

  return new Promise(resolve => {

    if (!b64) {
      resolve()
      return
    }

    try {

      const bytes =
        Uint8Array.from(
          atob(b64),
          c => c.charCodeAt(0)
        )

      const blob =
        new Blob(
          [bytes],
          {
            type: 'audio/wav'
          }
        )

      const url =
        URL.createObjectURL(blob)

      const audio =
        new Audio(url)

      audio.onended =
        () => {

          URL.revokeObjectURL(url)

          resolve()
        }

      audio.onerror =
        () => {

          URL.revokeObjectURL(url)

          resolve()
        }

      audio.play().catch(
        () => {

          URL.revokeObjectURL(url)

          resolve()
        }
      )

    } catch {

      resolve()
    }
  })
}


async function playPiperText(text) {

  const response =
    await fetch(
      '/api/tts',
      {
        method: 'POST',

        headers: {
          ...authHeaders(),
          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          text
        })
      }
    )

  let data = {}

  try {
    data =
      await response.json()
  } catch { }

  if (!response.ok) {

    throw new Error(
      data.detail || 'TTS failed'
    )
  }

  if (!data.tts_audio) {

    throw new Error(
      'TTS response did not contain audio'
    )
  }

  await playTtsAudio(
    data.tts_audio
  )
}


async function speakAndWait(
  text,
  b64 = null
) {

  if (b64) {

    await playTtsAudio(
      b64
    )

    return
  }

  await playPiperText(
    text
  )
}


/* ============================================================
   TOAST
============================================================ */

function showToast(
  msg,
  duration = 3000
) {

  const toast =
    $('voiceToast')

  toast.textContent =
    msg

  toast.classList.remove(
    'hidden'
  )

  clearTimeout(
    toast._timer
  )

  toast._timer =
    setTimeout(
      () => {
        toast.classList.add(
          'hidden'
        )
      },
      duration
    )
}


/* ============================================================
   VOICE MODAL
============================================================ */

function vShowStep(n) {

  const stepIds = [
    'vStep1',
    'vStep2',
    'vStep3',
    'vStep4',
    'vStepCallOptions'
  ]

  stepIds.forEach(
    id => {
      const el = $(id)
      if (!el) return

      if (n === 'call_options' || n === 5) {
        el.classList.toggle('hidden', id !== 'vStepCallOptions')
      } else {
        const targetId = `vStep${n}`
        el.classList.toggle('hidden', id !== targetId)
      }
    }
  )

  const activeDotNum = (n === 'call_options' || n === 5) ? 3 : (Number(n) || 1)

  for (
    let i = 1;
    i <= 4;
    i++
  ) {

    const dot =
      $(`vDot${i}`)

    if (dot) {
      dot.classList.toggle(
        'active',
        i <= activeDotNum
      )

      dot.classList.toggle(
        'done',
        i < activeDotNum
      )
    }
  }


  for (
    let i = 1;
    i <= 3;
    i++
  ) {

    const line = $(`vLine${i}`)
    if (line) {
      line.classList.toggle(
        'active',
        i < activeDotNum
      )
    }
  }
}


function resetVoiceState() {

  voice.state =
    'idle'

  voice.action =
    'send_message'

  voice.callType =
    'unspecified'

  voice.selectedUser =
    null

  voice.pendingMessage =
    null

  voice.searchResults =
    []

  voice.originalCommand =
    null

  voice.receiverName =
    null

  voice.awaitingUserSelection =
    false

  voice.awaitingConfirmation =
    false

  voice.awaitingCallSelection =
    false
}


function openVoiceModal() {

  stopRecording()

  resetVoiceState()

  $('vStatus').textContent =
    ''

  $('vMsgStatus').textContent =
    ''

  if ($('vOptionStatus')) {

    $('vOptionStatus').textContent =
      '🎤 After the options are spoken, say "option 1", "option 2", etc.'
  }

  if ($('vConfirmStatus')) {

    $('vConfirmStatus').textContent =
      ''
  }

  vShowStep(1)

  $('voiceModal')
    .classList.remove(
      'hidden'
    )
}


function closeVoiceModal() {

  stopRecording()

  resetVoiceState()

  $('voiceModal')
    .classList.add(
      'hidden'
    )
}


$('vCloseBtn')
  .addEventListener(
    'click',
    closeVoiceModal
  )


$('voiceModal')
  .addEventListener(
    'click',
    event => {

      if (
        event.target ===
        $('voiceModal')
      ) {
        closeVoiceModal()
      }
    }
  )


$('vBackBtn1')
  .addEventListener(
    'click',
    async () => {

      stopRecording()

      resetVoiceState()

      vShowStep(1)

      $('vStatus').textContent =
        ''
    }
  )


/* ============================================================
   RECORDING
============================================================ */

/*
IMPORTANT:

There must be only ONE _recorder declaration.

The previous version had:

let _recorder = null
let _chunks = []

twice.

That causes:

SyntaxError:
Identifier '_recorder' has already been declared
*/

let _recorder = null
let _chunks = []


function stopRecording() {

  if (
    _recorder &&
    _recorder.state ===
    'recording'
  ) {

    try {
      _recorder.stop()
    } catch { }
  }
}


/*
Records audio for maxDuration milliseconds.

For example:

record(10000)

means:

maximum 10 seconds.
*/

async function record(
  maxDuration = 10000
) {

  return new Promise(
    async (resolve, reject) => {

      let stream

      try {

        stream =
          await navigator
            .mediaDevices
            .getUserMedia({
              audio: true
            })

      } catch {

        reject(
          new Error(
            'Microphone access denied'
          )
        )

        return
      }


      _chunks = []


      const recorder =
        new MediaRecorder(
          stream
        )

      _recorder =
        recorder


      recorder.ondataavailable =
        event => {

          if (
            event.data &&
            event.data.size > 0
          ) {

            _chunks.push(
              event.data
            )
          }
        }


      recorder.onerror =
        event => {

          stream
            .getTracks()
            .forEach(
              track =>
                track.stop()
            )

          if (
            _recorder === recorder
          ) {
            _recorder = null
          }

          reject(
            event.error ||
            new Error(
              'Recording failed'
            )
          )
        }


      recorder.onstop =
        () => {

          stream
            .getTracks()
            .forEach(
              track =>
                track.stop()
            )

          const blob =
            new Blob(
              _chunks,
              {
                type: 'audio/webm'
              }
            )

          if (
            _recorder === recorder
          ) {
            _recorder = null
          }

          resolve(blob)
        }


      recorder.start()


      setTimeout(
        () => {

          if (
            recorder.state ===
            'recording'
          ) {

            recorder.stop()
          }

        },
        maxDuration
      )
    }
  )
}


/* ============================================================
   AUDIO API
============================================================ */

async function postAudio(
  url,
  blob
) {

  const form =
    new FormData()

  form.append(
    'audio',
    blob,
    'voice.webm'
  )


  const response =
    await fetch(
      url,
      {
        method: 'POST',

        headers:
          authHeaders(),

        body: form
      }
    )


  let data = {}

  try {

    data =
      await response.json()

  } catch { }


  if (!response.ok) {

    throw new Error(
      data.detail ||
      'Voice request failed'
    )
  }


  return data
}


/* ============================================================
   STEP 1
   INITIAL VOICE COMMAND
============================================================ */

$('vRecordBtn')
  .addEventListener(
    'click',
    async () => {

      const button =
        $('vRecordBtn')


      /*
      Allow manual stop.
      */

      if (
        _recorder &&
        _recorder.state ===
        'recording'
      ) {

        button.textContent =
          'Hold to record'

        stopRecording()

        return
      }


      button.textContent =
        '⏹ Recording... click to stop'

      button.classList.add(
        'recording'
      )

      $('vWaves1')
        .classList.add(
          'active'
        )

      $('vStatus').textContent =
        '🎤 Listening...'


      try {

        /*
        User can say:

        "send a message to Max
         saying hi, good morning"

        OR:

        "message Max"
        */

        const blob =
          await record(
            10000
          )


        button.classList.remove(
          'recording'
        )

        button.textContent =
          'Hold to record'

        $('vWaves1')
          .classList.remove(
            'active'
          )


        $('vStatus').textContent =
          '⏳ Understanding voice command...'


        const data =
          await postAudio(
            '/api/voice-search',
            blob
          )


        console.log(
          'VOICE SEARCH:',
          data
        )


        /*
        Save original command.
        */

        voice.originalCommand =
          data.transcribed_text ||
          ''

        voice.action =
          data.action ||
          'send_message'

        voice.callType =
          data.call_type ||
          'unspecified'


        /*
        ========================================================
        NO USER
        ========================================================
        */

        if (
          data.stage ===
          'user_not_found'
        ) {

          $('vStatus').textContent =
            data.message ||
            `❌ No user found for "${data.receiver || ''}"`


          if (data.tts_audio) {

            await playTtsAudio(
              data.tts_audio
            )

          } else {

            await speakAndWait(
              data.message ||
              'I could not find that user.'
            )
          }

          return
        }


        /*
        ========================================================
        MULTIPLE USERS
        ========================================================
        */

        if (
          data.stage ===
          'user_selection'
        ) {

          voice.state =
            'waiting_for_user'

          voice.awaitingUserSelection =
            true

          voice.action =
            data.action || 'send_message'

          voice.callType =
            data.call_type || 'unspecified'

          voice.receiverName =
            data.receiver || ''

          voice.pendingMessage =
            data.message?.trim() ||
            null

          voice.searchResults =
            Array.isArray(
              data.users
            )
              ? data.users
              : []


          if (
            !voice.searchResults.length
          ) {

            $('vStatus').textContent =
              '❌ No users were returned.'

            return
          }


          /*
          Show searched name.
          */

          $('vSearchedName')
            .textContent =
            `Results for "${voice.receiverName}"`


          /*
          Create options.
          */

          const list =
            $('vUserList')

          list.innerHTML = ''


          voice.searchResults
            .forEach(
              (user, index) => {

                const userButton =
                  document.createElement(
                    'button'
                  )

                userButton.className =
                  'vuser-row'


                userButton.innerHTML = `
                  <span class="voption-num">
                    ${index + 1}
                  </span>

                  <span class="avatar">
                    ${initials(user.username)}
                  </span>

                  <div class="vuser-info">

                    <strong>
                      ${user.username}
                    </strong>

                    <small>
                      Say "option ${index + 1}"
                    </small>

                  </div>
                `


                userButton
                  .addEventListener(
                    'click',
                    () => {

                      selectVoiceUser(
                        user
                      )
                    }
                  )


                list.appendChild(
                  userButton
                )
              }
            )


          vShowStep(2)


          /*
          IMPORTANT:

          Piper MUST finish speaking BEFORE
          Whisper starts recording.

          Otherwise Whisper can record Piper's
          own voice.
          */

          if (
            data.tts_audio
          ) {

            await playTtsAudio(
              data.tts_audio
            )

          } else {

            await playPiperText(
              buildOptionsSpeech(
                voice.searchResults
              )
            )
          }


          /*
          Now start Whisper.

          Example:

          User says:
          "option 1"

          */

          await startVoiceOptionSelect()

          return
        }


        /*
        ========================================================
        CALL OPTIONS (SINGLE USER CALL MATCH)
        ========================================================
        */

        if (
          data.stage ===
          'call_options' ||
          (data.action === 'call_user' && data.selected_user)
        ) {

          voice.selectedUser =
            data.selected_user

          voice.receiverName =
            data.receiver ||
            data.selected_user?.username

          voice.callType =
            data.call_type || 'unspecified'

          await showCallOptions(
            data.selected_user,
            voice.callType,
            data.tts_audio
          )

          return
        }


        /*
        ========================================================
        SINGLE USER / DIRECT CONFIRMATION (MESSAGE)
        ========================================================
        */

        if (
          data.stage ===
          'confirmation'
        ) {

          voice.state =
            'waiting_for_confirmation'

          voice.selectedUser =
            data.selected_user

          voice.receiverName =
            data.receiver ||
            data.selected_user?.username

          voice.pendingMessage =
            data.message?.trim() ||
            null


          if (
            !voice.selectedUser
          ) {

            throw new Error(
              'No selected user was returned by the server.'
            )
          }


          /*
          If message is missing,
          ask for it first.
          */

          if (
            !voice.pendingMessage
          ) {

            await askForMessage(
              voice.selectedUser
            )

            return
          }


          /*
          Message already exists.

          Go directly to confirmation.
          */

          showConfirmationStep()

          await requestVoiceConfirmation()

          return
        }


        /*
        ========================================================
        FALLBACK
        ========================================================
        */

        $('vStatus').textContent =
          data.message ||
          '❌ I could not understand the voice command.'


        if (data.tts_audio) {

          await playTtsAudio(
            data.tts_audio
          )
        }

      } catch (error) {

        console.error(
          'Voice command error:',
          error
        )

        button.classList.remove(
          'recording'
        )

        button.textContent =
          'Hold to record'

        $('vWaves1')
          .classList.remove(
            'active'
          )

        $('vStatus').textContent =
          `❌ ${error.message}`
      }
    }
  )


/* ============================================================
   BUILD OPTION SPEECH
============================================================ */

function buildOptionsSpeech(
  users
) {

  const names =
    users.map(
      (user, index) =>
        `Option ${index + 1}. ${user.username}`
    )


  return (
    'I found these users. ' +
    names.join('. ') +
    '. Please say option 1, option 2, or the option number you want to select.'
  )
}


/* ============================================================
   STEP 2
   AUTOMATIC VOICE OPTION SELECTION
============================================================ */

async function startVoiceOptionSelect() {

  if (
    voice.state !==
    'waiting_for_user'
  ) {
    return
  }


  if (
    !voice.searchResults.length
  ) {
    return
  }


  voice.awaitingUserSelection =
    true


  $('vStatus').textContent =
    '🎤 Listening for option...'


  try {

    /*
    Whisper listens for:

    "option 1"

    "option one"

    "one"

    etc.
    */

    const blob =
      await record(
        7000
      )


    /*
    User closed modal while
    recording.
    */

    if (
      $('voiceModal')
        .classList.contains(
          'hidden'
        )
    ) {
      return
    }


    $('vStatus').textContent =
      '⏳ Understanding option...'


    const data =
      await postAudio(
        '/api/voice-select',
        blob
      )


    console.log(
      'VOICE OPTION:',
      data
    )


    /*
    Backend returns:

    selected_index: 0
    selected_index: 1
    etc.
    */

    if (
      data.selected_index ===
      null ||
      data.selected_index ===
      undefined
    ) {

      const heard =
        data.transcribed_text ||
        ''


      $('vStatus').textContent =
        `❓ I heard "${heard}". Please say option 1, option 2, and so on.`


      await playPiperText(
        'I did not understand the option. Please say the option number.'
      )


      /*
      Listen again.
      */

      await startVoiceOptionSelect()

      return
    }


    const index =
      Number(
        data.selected_index
      )


    /*
    Make sure the option exists.
    */

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >=
      voice.searchResults.length
    ) {

      $('vStatus').textContent =
        '❌ That option does not exist.'


      await playPiperText(
        'That option does not exist. Please say another option number.'
      )


      await startVoiceOptionSelect()

      return
    }


    /*
    Select user.
    */

    const selectedUser =
      voice.searchResults[index]


    await selectVoiceUser(
      selectedUser
    )

  } catch (error) {

    console.error(
      'Voice option error:',
      error
    )


    $('vStatus').textContent =
      `❌ ${error.message}`

  } finally {

    voice.awaitingUserSelection =
      false
  }
}


/* ============================================================
   SELECT USER
============================================================ */

async function selectVoiceUser(
  user
) {

  if (!user) {
    return
  }


  /*
  Stop any active recording.
  */

  stopRecording()


  voice.selectedUser =
    user

  voice.receiverName =
    user.username

  voice.awaitingUserSelection =
    false


  console.log(
    'SELECTED USER:',
    user,
    'ACTION:',
    voice.action
  )


  /*
  ============================================================
  CALL ACTION
  ============================================================
  */
  if (voice.action === 'call_user') {
    await showCallOptions(
      user,
      voice.callType || 'unspecified'
    )
    return
  }


  /*
  ============================================================
  MESSAGE ALREADY EXISTS
  ============================================================
  */

  if (
    voice.pendingMessage &&
    voice.pendingMessage.trim()
  ) {

    voice.state =
      'waiting_for_confirmation'


    $('vSelectedUser')
      .textContent =
      user.username

    $('vPreviewMsg')
      .textContent =
      voice.pendingMessage


    vShowStep(4)


    /*
    Piper:

    "Are you sure..."
    */

    await requestVoiceConfirmation()

    return
  }


  /*
  ============================================================
  NO MESSAGE YET
  ============================================================
  */

  await askForMessage(
    user
  )
}


/* ============================================================
   ASK FOR MESSAGE
============================================================ */

async function askForMessage(
  user
) {

  voice.state =
    'waiting_for_message'


  voice.selectedUser =
    user


  voice.pendingMessage =
    null


  $('vReceiverName')
    .textContent =
    user.username


  $('vMsgStatus')
    .textContent =
    '🎤 Waiting for your message...'


  vShowStep(3)


  /*
  Piper asks:

  "What message would you like
   to send to Max?"
  */

  await playPiperText(
    `What message would you like to send to ${user.username}?`
  )


  /*
  Automatically start recording.

  User says:

  "hi, good morning"

  */

  await recordVoiceMessage()
}


/* ============================================================
   RECORD MESSAGE
============================================================ */

async function recordVoiceMessage() {

  if (
    voice.state !==
    'waiting_for_message'
  ) {
    return
  }


  $('vMsgStatus')
    .textContent =
    '🎤 Listening for your message...'


  try {

    const blob =
      await record(
        10000
      )


    $('vMsgStatus')
      .textContent =
      '⏳ Transcribing message...'


    const data =
      await postAudio(
        '/api/voice-transcribe',
        blob
      )


    const message =
      (data.text || '')
        .trim()


    console.log(
      'VOICE MESSAGE:',
      message
    )


    if (!message) {

      $('vMsgStatus')
        .textContent =
        '❌ I could not understand the message.'


      await playPiperText(
        'I could not understand your message. Please say it again.'
      )


      await recordVoiceMessage()

      return
    }


    /*
    Save message.
    */

    voice.pendingMessage =
      message


    /*
    Show confirmation preview.
    */

    $('vSelectedUser')
      .textContent =
      voice.selectedUser.username

    $('vPreviewMsg')
      .textContent =
      message


    voice.state =
      'waiting_for_confirmation'


    vShowStep(4)


    /*
    Ask:

    "Are you sure..."
    */

    await requestVoiceConfirmation()

  } catch (error) {

    console.error(
      'Voice message error:',
      error
    )

    $('vMsgStatus')
      .textContent =
      `❌ ${error.message}`
  }
}


/* ============================================================
   MANUAL MESSAGE RECORD BUTTON
============================================================ */

/*
This still works if the user wants to manually
click the microphone in Step 3.
*/

$('vMsgRecordBtn')
  .addEventListener(
    'click',
    async () => {

      if (
        _recorder &&
        _recorder.state ===
        'recording'
      ) {

        stopRecording()

        return
      }


      await recordVoiceMessage()
    }
  )


/* ============================================================
   SHOW CONFIRMATION
============================================================ */

function showConfirmationStep() {

  if (
    !voice.selectedUser ||
    !voice.pendingMessage
  ) {
    return
  }


  $('vSelectedUser')
    .textContent =
    voice.selectedUser.username


  $('vPreviewMsg')
    .textContent =
    voice.pendingMessage


  $('vConfirmStatus')
    .textContent =
    ''


  vShowStep(4)
}


/* ============================================================
   ASK FOR CONFIRMATION
============================================================ */

async function requestVoiceConfirmation() {

  if (
    !voice.selectedUser ||
    !voice.pendingMessage
  ) {

    return
  }


  voice.state =
    'waiting_for_confirmation'


  voice.awaitingConfirmation =
    true


  const username =
    voice.selectedUser.username


  const message =
    voice.pendingMessage


  /*
  Do not put arbitrary huge messages
  into the TTS sentence.
  */

  const confirmationText =
    `Are you sure you want to send the message "${message}" to ${username}? Please say yes to send it or no to cancel.`


  $('vConfirmStatus')
    .textContent =
    '🔊 Asking for confirmation...'


  /*
  IMPORTANT:

  Piper speaks FIRST.
  Whisper starts ONLY after Piper ends.

  This prevents Whisper from hearing Piper.
  */

  await playPiperText(
    confirmationText
  )


  /*
  Now listen for:

  "yes"

  "yes I'm confirm"

  "yes confirm"

  "yeah send it"

  "okay send"

  "no"

  "cancel"

  etc.
  */

  await listenForConfirmation()
}


/* ============================================================
   CONFIRMATION LISTENER
============================================================ */

async function listenForConfirmation() {

  if (
    voice.state !==
    'waiting_for_confirmation'
  ) {

    return
  }


  $('vConfirmStatus')
    .textContent =
    '🎤 Listening for confirmation...'


  try {

    /*
    Give user 7 seconds to answer.
    */

    const blob =
      await record(
        7000
      )


    $('vConfirmStatus')
      .textContent =
      '⏳ Understanding confirmation...'


    const data =
      await postAudio(
        '/api/voice-confirm',
        blob
      )


    console.log(
      'VOICE CONFIRMATION:',
      data
    )


    /*
    =========================================================
    YES
    =========================================================
    */

    if (
      data.confirmed === true
    ) {

      voice.awaitingConfirmation =
        false

      voice.state =
        'sending'


      $('vConfirmStatus')
        .textContent =
        '✅ Confirmed. Sending message...'


      await sendVoiceMessage()

      return
    }


    /*
    =========================================================
    NO
    =========================================================
    */

    if (
      data.confirmed === false
    ) {

      voice.awaitingConfirmation =
        false

      $('vConfirmStatus')
        .textContent =
        '❌ Message cancelled.'


      await playPiperText(
        'Okay. I cancelled the message.'
      )


      setTimeout(
        () => {
          closeVoiceModal()
        },
        500
      )


      return
    }


    /*
    =========================================================
    UNKNOWN
    =========================================================
    */

    const heard =
      data.transcribed_text ||
      ''

    console.log('Heard: ' + heard)

    $('vConfirmStatus')
      .textContent =
      `❓ I heard "${heard}", but I could not understand.`


    await playPiperText(
      'I did not understand. Please say yes to send the message, or no to cancel.'
    )


    /*
    Listen again.
    */

    await listenForConfirmation()

  } catch (error) {

    console.error(
      'Confirmation error:',
      error
    )


    $('vConfirmStatus')
      .textContent =
      `❌ ${error.message}`
  }
}


/* ============================================================
   SEND VOICE MESSAGE
============================================================ */

async function sendVoiceMessage() {

  if (
    !voice.selectedUser ||
    !voice.pendingMessage
  ) {

    throw new Error(
      'Missing selected user or message.'
    )
  }


  const user =
    voice.selectedUser


  const message =
    voice.pendingMessage


  try {

    /*
    Use the same WebSocket
    system as normal chat.
    */

    await sendViaSocket(
      user,
      message
    )


    $('vConfirmStatus')
      .textContent =
      `✅ Message sent to ${user.username}`


    await playPiperText(
      `Message sent to ${user.username}.`
    )


    showToast(
      `✅ Sent to ${user.username}`,
      3000
    )


    /*
    Close after TTS finishes.
    */

    setTimeout(
      () => {

        closeVoiceModal()

      },
      700
    )

  } catch (error) {

    console.error(
      'Send voice message error:',
      error
    )


    $('vConfirmStatus')
      .textContent =
      `❌ ${error.message}`


    try {

      await playPiperText(
        'I could not send the message. Please try again.'
      )

    } catch { }
  }
}


/* ============================================================
   CALL OPTIONS STEP & ACTIONS
============================================================ */

async function showCallOptions(user, callType = 'unspecified', ttsAudio = null) {
  if (!user) return

  stopRecording()

  voice.state = 'waiting_for_call_choice'
  voice.action = 'call_user'
  voice.selectedUser = user
  voice.receiverName = user.username
  voice.callType = callType
  voice.awaitingCallSelection = true

  const targetEl = $('vCallTargetUser')
  if (targetEl) {
    targetEl.textContent = user.username
  }

  const statusEl = $('vCallStatus')
  if (statusEl) {
    statusEl.textContent = '🎤 Say "audio" or "video" or click above.'
  }

  // If user already specified direct audio or video call
  if (callType === 'audio' || callType === 'video') {
    await startCallToUser(user, callType)
    return
  }

  // Otherwise show the interactive choice step
  vShowStep('call_options')

  const promptText = `I found ${user.username}. Would you like an audio call or a video call?`

  if (ttsAudio) {
    await playTtsAudio(ttsAudio)
  } else {
    await playPiperText(promptText)
  }

  // Listen for user voice response ("audio", "video", "voice", "cancel")
  await listenForCallChoice()
}


async function listenForCallChoice() {
  if (voice.state !== 'waiting_for_call_choice' || !voice.awaitingCallSelection) {
    return
  }

  const statusEl = $('vCallStatus')
  if (statusEl) {
    statusEl.textContent = '🎤 Listening... Say "audio" or "video"'
  }

  try {
    const blob = await record(7000)

    if ($('voiceModal').classList.contains('hidden')) {
      return
    }

    if (statusEl) {
      statusEl.textContent = '⏳ Understanding call preference...'
    }

    const data = await postAudio('/api/voice-transcribe', blob)
    const text = (data.text || '').toLowerCase()

    console.log('CALL CHOICE HEARD:', text)

    if (text.includes('video') || text.includes('camera') || text.includes('facetime')) {
      await startCallToUser(voice.selectedUser, 'video')
      return
    }

    if (text.includes('audio') || text.includes('voice') || text.includes('phone') || text.includes('call')) {
      await startCallToUser(voice.selectedUser, 'audio')
      return
    }

    if (text.includes('cancel') || text.includes('stop') || text.includes('no') || text.includes('close')) {
      if (statusEl) statusEl.textContent = '❌ Call cancelled.'
      await playPiperText('Call cancelled.')
      setTimeout(() => { closeVoiceModal() }, 500)
      return
    }

    // Unrecognized speech - prompt again
    if (statusEl) {
      statusEl.textContent = `❓ Heard "${text}". Please say "audio" or "video".`
    }
    await playPiperText('Please say audio call or video call.')
    await listenForCallChoice()

  } catch (error) {
    console.error('Call choice error:', error)
    if (statusEl) {
      statusEl.textContent = `❌ ${error.message}`
    }
  }
}


async function startCallToUser(user, callType = 'video') {
  if (!user) return

  stopRecording()
  voice.awaitingCallSelection = false

  const statusEl = $('vCallStatus')
  if (statusEl) {
    statusEl.textContent = `📞 Starting ${callType} call with ${user.username}...`
  }

  await playPiperText(`Starting ${callType === 'audio' ? 'audio' : 'video'} call with ${user.username}.`)

  closeVoiceModal()

  // Open conversation with selected user and trigger WebRTC call
  await openConversation(user)

  // Start outgoing call
  setTimeout(async () => {
    try {
      if (window.LivekitClient) {
        const roomName = [state.session.id, user.id].sort().join('-')
        sendCallSignal({
          type: 'call_invite',
          target_id: user.id,
          target_ids: [user.id],
          room_name: roomName,
          participant_names: [user.username]
        })
        await lkJoinRoom(roomName, user.username, user.email || '')
      } else {
        await startOutgoingCall()
      }
    } catch (err) {
      console.error('Error starting outgoing call:', err)
      showToast(`❌ Could not start call: ${err.message}`, 4000)
    }
  }, 300)
}


// Wire Call Option Step Buttons
const vAudioBtn = $('vStartAudioCallBtn')
if (vAudioBtn) {
  vAudioBtn.addEventListener('click', async () => {
    if (voice.selectedUser) {
      await startCallToUser(voice.selectedUser, 'audio')
    }
  })
}

const vVideoBtn = $('vStartVideoCallBtn')
if (vVideoBtn) {
  vVideoBtn.addEventListener('click', async () => {
    if (voice.selectedUser) {
      await startCallToUser(voice.selectedUser, 'video')
    }
  })
}

const vCallBack = $('vCallBackBtn')
if (vCallBack) {
  vCallBack.addEventListener('click', () => {
    stopRecording()
    resetVoiceState()
    vShowStep(1)
    $('vStatus').textContent = ''
  })
}

const vConfirmBtn = $('vConfirmBtn')
if (vConfirmBtn) {
  vConfirmBtn.addEventListener('click', async () => {
    voice.awaitingConfirmation = false
    voice.state = 'sending'
    $('vConfirmStatus').textContent = '✅ Sending message...'
    await sendVoiceMessage()
  })
}

const vRetryBtn = $('vRetryBtn')
if (vRetryBtn) {
  vRetryBtn.addEventListener('click', () => {
    closeVoiceModal()
  })
}


/* ============================================================
   GLOBAL VOICE BUTTON
============================================================ */

$('globalVoiceBtn')
  .addEventListener(
    'click',
    () => {

      if (!state.session) {
        return
      }

      openVoiceModal()
    }
  )


/* ============================================================
   CHAT MICROPHONE
============================================================ */

$('chatVoiceBtn')
  .addEventListener(
    'click',
    async () => {

      const button =
        $('chatVoiceBtn')


      if (
        _recorder &&
        _recorder.state ===
        'recording'
      ) {

        button.classList.remove(
          'recording'
        )

        stopRecording()

        return
      }


      button.classList.add(
        'recording'
      )


      try {

        const blob =
          await record(
            10000
          )


        button.classList.remove(
          'recording'
        )


        showToast(
          '⏳ Transcribing...',
          3000
        )


        const data =
          await postAudio(
            '/api/voice-transcribe',
            blob
          )


        $('messageInput')
          .value =
          data.text || ''


        $('messageInput')
          .focus()


        showToast(
          '✅ Tap send to confirm',
          3000
        )

      } catch (error) {

        button.classList.remove(
          'recording'
        )


        showToast(
          `❌ ${error.message}`,
          4000
        )
      }
    }
  )


/* ============================================================
   SEND THROUGH WEBSOCKET
============================================================ */

async function sendViaSocket(
  receiver,
  message
) {


  if (
    state.selected?.id ===
    receiver.id &&
    state.socket?.readyState ===
    WebSocket.OPEN
  ) {

    const key = await getDirectConversationKey(receiver.id, receiver)
    const encrypted = await encryptMessage(message, key)
    if (!encrypted || encrypted === message) {
      showToast('🔒 Peer has not set up encryption yet — message not sent.', 5000)
      return
    }

    state.socket.send(
      JSON.stringify({
        content: encrypted
      })
    )

    return
  }


  /*
  Open conversation.
  */

  await openConversation(
    receiver
  )


  /*
  Wait until WebSocket becomes OPEN.
  */

  await new Promise(
    (resolve, reject) => {

      const timeout =
        setTimeout(
          () => {

            clearInterval(
              check
            )

            reject(
              new Error(
                'Socket timeout'
              )
            )

          },
          6000
        )


      const check =
        setInterval(
          () => {

            if (
              state.socket?.readyState ===
              WebSocket.OPEN
            ) {

              clearInterval(
                check
              )

              clearTimeout(
                timeout
              )

              resolve()
            }

          },
          100
        )
    }
  )


  /*
  Finally send message.
  */

  const key = await getDirectConversationKey(receiver.id, receiver)
  const encrypted = await encryptMessage(message, key)
  if (!encrypted || encrypted === message) {
    showToast('🔒 Peer has not set up encryption yet — message not sent.', 5000)
    return
  }

  state.socket.send(
    JSON.stringify({
      content: encrypted
    })
  )
}


/* ============================================================
   INITIAL SESSION
============================================================ */

if (state.session) {

  setView(true)
  updateProfileUI(state.session)
  initE2EE().catch(console.error)
  connectSignal()

  refreshConversations()
    .catch(
      () => {

        localStorage.removeItem(
          'relay_session'
        )

        state.session =
          null

        setView(false)
      }
    )
}



/* ============================================================
   VIDEO CALL – LiveKit SFU (primary) + legacy P2P fallback
   ============================================================ */

const CALL_TYPES = new Set([
  'call_offer', 'call_answer', 'call_ice', 'call_reject', 'call_end',
  'call_invite', 'call_leave'
])

// ── Legacy P2P state (kept for fallback / 1-on-1 without LiveKit) ──
const call = {
  pc: null,
  localStream: null,
  inCall: false,
  incomingOffer: null,
  peerId: null,
  peerName: '',
  peerEmail: '',
  pendingIce: [],
  isAvatarFallback: false,
  localRecorder: null,
  remoteRecorder: null,
  localChunks: [],
  remoteChunks: [],
  callStartTime: null,
  recording: false,
  events: []
}

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}

function wsProtocol() {
  return location.protocol === 'https:' ? 'wss' : 'ws'
}

let ringtoneAudioCtx = null
let ringtoneInterval = null

function startRingtone() {
  stopRingtone()
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    ringtoneAudioCtx = new AudioCtx()
    const playTone = () => {
      if (!ringtoneAudioCtx || ringtoneAudioCtx.state === 'closed') return
      if (ringtoneAudioCtx.state === 'suspended') {
        ringtoneAudioCtx.resume().catch(() => {})
      }
      const now = ringtoneAudioCtx.currentTime
      const osc = ringtoneAudioCtx.createOscillator()
      const gain = ringtoneAudioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.setValueAtTime(650, now + 0.15)
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc.connect(gain)
      gain.connect(ringtoneAudioCtx.destination)
      osc.start(now)
      osc.stop(now + 0.6)
    }
    playTone()
    ringtoneInterval = setInterval(playTone, 2000)
  } catch (err) {
    console.warn('[Ringtone] Audio error:', err)
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval)
    ringtoneInterval = null
  }
  if (ringtoneAudioCtx) {
    try { ringtoneAudioCtx.close() } catch {}
    ringtoneAudioCtx = null
  }
}

function connectSignal() {
  if (
    !state.session ||
    (state.signalSocket &&
      (state.signalSocket.readyState === WebSocket.OPEN ||
        state.signalSocket.readyState === WebSocket.CONNECTING))
  ) {
    return
  }

  const socket = new WebSocket(
    `${wsProtocol()}://${location.host}/ws/signal?token=${state.session.access_token}`
  )

  state.signalSocket = socket

  socket.onopen = () => {
    console.log('[Signal] Connected to /ws/signal')
  }

  socket.onmessage = async event => {
    try {
      const data = JSON.parse(event.data)
      await handleCallSignal(data)
    } catch (err) {
      console.error('[Signal] parse error:', err)
    }
  }

  socket.onerror = err => {
    console.warn('[Signal] WebSocket error:', err)
  }

  socket.onclose = () => {
    if (state.signalSocket === socket) {
      state.signalSocket = null
    }
    if (state.session) {
      setTimeout(connectSignal, 1500)
    }
  }
}

function sendCallSignal(payload) {
  const targetId = payload.target_id || (payload.target_ids && payload.target_ids[0]) || call.peerId
  const message = JSON.stringify({
    target_id: targetId,
    sender_username: state.session?.username || '',
    sender_email: state.session?.email || '',
    ...payload
  })

  if (
    state.signalSocket &&
    state.signalSocket.readyState === WebSocket.OPEN
  ) {
    state.signalSocket.send(message)
    return
  }

  if (
    state.socket &&
    state.socket.readyState === WebSocket.OPEN
  ) {
    state.socket.send(message)
    return
  }

  console.warn('[Signal] No open socket for signaling, reconnecting...')
  connectSignal()
}

// ── LiveKit SFU Call Manager ───────────────────────────────────────

const lk = {
  room: null,
  isConnected: false,
  roomName: '',
  timerInterval: null,
  callStartTime: null,
  isScreenSharing: false,
  screenTrack: null,
  // recording (for n8n call-summary pipeline)
  localRecorder: null,
  remoteRecorder: null,
  localChunks: [],
  remoteChunks: [],
  recording: false,
  events: [],
  peerName: '',
  peerEmail: '',
  // group call context
  groupName: '',
  groupMembers: []   // [{ id, username, email }]
}

function lkInitials(name) {
  return initials(name || '?')
}

// Update the grid data-count attribute so CSS picks the right grid layout
function lkUpdateGridLayout() {
  const grid = $('lkVideoGrid')
  if (!grid) return
  const count = grid.querySelectorAll('.lk-tile').length
  let label
  if (count <= 6) label = String(count)
  else label = 'many'
  grid.setAttribute('data-count', label)

  const badge = $('lkParticipantCount')
  if (badge) {
    const total = count + 1 // +self
    badge.textContent = `${total} participant${total !== 1 ? 's' : ''}`
  }
}

// Create a tile element for a remote participant
function lkCreateTile(identity, displayName) {
  const tile = document.createElement('div')
  tile.className = 'lk-tile'
  tile.id = `lk-tile-${identity}`

  const avatar = document.createElement('div')
  avatar.className = 'lk-tile-avatar'
  avatar.textContent = lkInitials(displayName || identity)

  const label = document.createElement('div')
  label.className = 'lk-tile-label'
  label.id = `lk-label-${identity}`
  label.textContent = displayName || identity

  tile.appendChild(avatar)
  tile.appendChild(label)
  return tile
}

// Attach/detach a video or audio element track to a tile
function lkAttachTrack(participant, trackPublication) {
  const tile = document.getElementById(`lk-tile-${participant.identity}`)
  if (!tile) return

  const track = trackPublication.track
  if (!track) return

  if (trackPublication.kind === 'video') {
    let video = tile.querySelector('video')
    if (!video) {
      video = document.createElement('video')
      video.autoplay = true
      video.playsInline = true
      // Screen share tracks should not be mirrored
      video.className = trackPublication.source === LivekitClient.Track.Source.ScreenShare
        ? 'unmirrored' : ''
      tile.prepend(video)
    }
    track.attach(video)

    // Screen share badge
    if (trackPublication.source === LivekitClient.Track.Source.ScreenShare) {
      if (!tile.querySelector('.lk-tile-screen-badge')) {
        const badge = document.createElement('div')
        badge.className = 'lk-tile-screen-badge'
        badge.textContent = '🖥 Screen Share'
        tile.appendChild(badge)
      }
    }

    // Hide avatar when video is active
    const av = tile.querySelector('.lk-tile-avatar')
    if (av) av.style.display = 'none'

  } else if (trackPublication.kind === 'audio') {
    let audio = tile.querySelector('audio')
    if (!audio) {
      audio = document.createElement('audio')
      audio.autoplay = true
      tile.appendChild(audio)
    }
    track.attach(audio)
    // Connect to the remote audio mixer if recording is active
    if (lk.remoteAudioDest && lk.remoteAudioCtx && track.mediaStreamTrack) {
      try {
        const source = lk.remoteAudioCtx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]))
        source.connect(lk.remoteAudioDest)
      } catch (err) { console.warn('Audio mix err on attach:', err) }
    }
  }
}

function lkDetachTrack(participant, trackPublication) {
  const tile = document.getElementById(`lk-tile-${participant.identity}`)
  if (!tile) return

  const track = trackPublication.track
  if (!track) return
  track.detach()

  if (trackPublication.kind === 'video') {
    const video = tile.querySelector('video')
    if (video) video.remove()
    // Show avatar fallback
    const av = tile.querySelector('.lk-tile-avatar')
    if (av) av.style.display = ''
    // Remove screen share badge
    const badge = tile.querySelector('.lk-tile-screen-badge')
    if (badge) badge.remove()
  }
}

function lkAddParticipant(participant) {
  const grid = $('lkVideoGrid')
  if (!grid) return
  if (document.getElementById(`lk-tile-${participant.identity}`)) return

  const tile = lkCreateTile(participant.identity, participant.name)
  grid.appendChild(tile)
  lkUpdateGridLayout()

  // Attach any already-published tracks
  participant.trackPublications.forEach(pub => {
    if (pub.track) lkAttachTrack(participant, pub)
  })
}

function lkRemoveParticipant(participant) {
  const tile = document.getElementById(`lk-tile-${participant.identity}`)
  if (tile) tile.remove()
  lkUpdateGridLayout()
}

function lkUpdateMuteLabel(participant) {
  const label = document.getElementById(`lk-label-${participant.identity}`)
  if (!label) return
  const isMuted = !participant.isMicrophoneEnabled
  const existing = label.querySelector('.lk-tile-muted')
  if (isMuted && !existing) {
    const m = document.createElement('span')
    m.className = 'lk-tile-muted'
    m.textContent = '🔇'
    label.appendChild(m)
  } else if (!isMuted && existing) {
    existing.remove()
  }
}

function lkStartTimer() {
  lk.callStartTime = new Date()
  if (lk.timerInterval) clearInterval(lk.timerInterval)
  lk.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - lk.callStartTime) / 1000)
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    const el = $('lkCallTimer')
    if (el) el.textContent = `${m}:${s}`
  }, 1000)
}

function lkStopTimer() {
  if (lk.timerInterval) {
    clearInterval(lk.timerInterval)
    lk.timerInterval = null
  }
}

async function lkStartRecording() {
  if (lk.recording) return
  lk.recording = true
  lk.localChunks = []
  lk.remoteChunks = []
  lk.events = []
  lkLogEvent('Recording started')
  lkLogEvent('You joined', { participant: state.session?.username })

  const mime = bestMimeType()
  // Record local mic from localVideo srcObject
  const localVid = $('localVideo')
  if (localVid && localVid.srcObject) {
    const audioTracks = localVid.srcObject.getAudioTracks
      ? localVid.srcObject.getAudioTracks()
      : []
    if (audioTracks.length) {
      try {
        lk.localRecorder = new MediaRecorder(
          new MediaStream(audioTracks),
          mime ? { mimeType: mime } : {}
        )
        lk.localRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) lk.localChunks.push(e.data)
        }
        lk.localRecorder.start(1000)
      } catch (e) { console.warn('[LK Recording] local failed:', e) }
    }
  }

  // Setup remote audio recording via WebAudio API mixer
  try {
    lk.remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
    lk.remoteAudioDest = lk.remoteAudioCtx.createMediaStreamDestination()
    lk.remoteRecorder = new MediaRecorder(lk.remoteAudioDest.stream, mime ? { mimeType: mime } : {})
    lk.remoteRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) lk.remoteChunks.push(e.data) }
    lk.remoteRecorder.start(1000)

    // Mix any currently subscribed audio tracks
    if (lk.room && lk.room.remoteParticipants) {
      lk.room.remoteParticipants.forEach(p => {
        p.audioTracks.forEach(pub => {
          if (pub.track && pub.track.mediaStreamTrack) {
            try {
              const source = lk.remoteAudioCtx.createMediaStreamSource(new MediaStream([pub.track.mediaStreamTrack]))
              source.connect(lk.remoteAudioDest)
            } catch (err) {}
          }
        })
      })
    }
  } catch (err) { console.warn('[LK Recording] remote failed:', err) }
}

function lkLogEvent(eventName, detail = {}) {
  lk.events.push({
    time: new Date().toISOString(),
    event: eventName,
    participant: state.session?.username || 'Me',
    ...detail
  })
}

// Request a LiveKit token from the backend
async function lkGetToken(roomName) {
  const res = await fetch('/api/livekit/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.session.access_token}`
    },
    body: JSON.stringify({ room_name: roomName })
  })
  if (!res.ok) throw new Error('Failed to get LiveKit token')
  return res.json()
}

// Join a LiveKit room — works for both 1-on-1 and group
async function lkJoinRoom(roomName, peerName, peerEmail) {
  if (!window.LivekitClient) {
    showToast('❌ LiveKit client not loaded', 4000)
    return
  }

  try {
    const { token, server_url, room_name } = await lkGetToken(roomName)
    lk.roomName = room_name
    lk.peerName = peerName || ''
    lk.peerEmail = peerEmail || ''
    // Capture group context (if this is a group call)
    if (state.selectedGroup) {
      lk.groupName = state.selectedGroup.name || ''
      lk.groupMembers = state.selectedGroup.members || []
    } else {
      lk.groupName = ''
      lk.groupMembers = []
    }

    if (lk.room) {
      await lk.room.disconnect()
    }

    const room = new LivekitClient.Room({
      adaptiveStream: true,
      dynacast: true
    })
    lk.room = room
    lk.isConnected = false

    // ── Room event handlers ────────────────────────────────────────

    room.on(LivekitClient.RoomEvent.Connected, () => {
      lk.isConnected = true
      lkLogEvent('Room connected', { room: room_name })
      lkStartTimer()
      lkStartRecording()

      const nameEl = $('lkRoomName')
      if (nameEl) nameEl.textContent = room_name

      // Publish local camera + mic
      room.localParticipant.enableCameraAndMicrophone().catch(err => {
        console.warn('[LK] camera/mic error:', err)
        // Try audio only
        room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
      })

      // Attach local preview to PiP
      const localVid = $('localVideo')
      if (localVid) {
        room.localParticipant.trackPublications.forEach(pub => {
          if (pub.track && pub.kind === 'video') {
            pub.track.attach(localVid)
          }
        })
      }

      lkUpdateGridLayout()
    })

    room.on(LivekitClient.RoomEvent.TrackPublished, (pub, participant) => {
      // Auto-subscribe
      pub.setSubscribed(true)
    })

    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
      lkAttachTrack(participant, pub)
    })

    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
      lkDetachTrack(participant, pub)
    })

    room.on(LivekitClient.RoomEvent.ParticipantConnected, participant => {
      lkAddParticipant(participant)
      lkLogEvent('Participant joined', { participant: participant.name || participant.identity })
      showToast(`✅ ${participant.name || participant.identity} joined`, 2500)
    })

    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, participant => {
      lkRemoveParticipant(participant)
      lkLogEvent('Participant left', { participant: participant.name || participant.identity })
      showToast(`👋 ${participant.name || participant.identity} left`, 2500)
    })

    room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, speakers => {
      // Clear all speaking highlights
      document.querySelectorAll('.lk-tile.speaking').forEach(t => t.classList.remove('speaking'))
      // Highlight current speakers
      speakers.forEach(p => {
        const tile = document.getElementById(`lk-tile-${p.identity}`)
        if (tile) tile.classList.add('speaking')
      })
    })

    room.on(LivekitClient.RoomEvent.TrackMuted, (pub, participant) => {
      lkUpdateMuteLabel(participant)
    })

    room.on(LivekitClient.RoomEvent.TrackUnmuted, (pub, participant) => {
      lkUpdateMuteLabel(participant)
    })

    room.on(LivekitClient.RoomEvent.LocalTrackPublished, (pub) => {
      if (pub.kind === 'video') {
        const localVid = $('localVideo')
        if (localVid && pub.track) {
          pub.track.attach(localVid)
          const selfAvatar = $('lkSelfAvatar')
          if (selfAvatar) selfAvatar.classList.add('hidden')
        }
      }
    })

    room.on(LivekitClient.RoomEvent.Disconnected, () => {
      lk.isConnected = false
      lkLogEvent('Room disconnected')
      lkEndCall()
    })

    room.on(LivekitClient.RoomEvent.MediaDevicesError, err => {
      console.warn('[LK] media devices error:', err)
      showToast('⚠️ Camera or microphone error. Check device permissions.', 4000)
      // Show avatar in self pip
      const selfAvatar = $('lkSelfAvatar')
      if (selfAvatar) {
        selfAvatar.textContent = lkInitials(state.session?.username)
        selfAvatar.classList.remove('hidden')
      }
    })

    // ── Connect ───────────────────────────────────────────────────
    await room.connect(server_url, token)

    // ── Add already-connected participants ────────────────────────
    const grid = $('lkVideoGrid')
    if (grid) grid.innerHTML = ''
    room.remoteParticipants.forEach(participant => {
      lkAddParticipant(participant)
    })

    // ── Show the video modal ──────────────────────────────────────
    $('videoModal').classList.remove('hidden')
    setCallButtonsBusy(true)

    // Update self pip avatar initial
    const selfAvatar = $('lkSelfAvatar')
    if (selfAvatar) selfAvatar.textContent = lkInitials(state.session?.username)

  } catch (err) {
    console.error('[LK] join room error:', err)
    showToast(`❌ ${err.message}`, 5000)
    lkEndCall()
  }
}

function lkEndCall() {
  stopRingtone()
  lkStopTimer()
  setCallButtonsBusy(false)

  // Capture state before resetting
  const wasRecording = lk.recording
  const localRecorder = lk.localRecorder
  const localChunks = lk.localChunks
  const callStartTime = lk.callStartTime ? lk.callStartTime.toISOString() : null
  const peerName = lk.peerName
  const peerEmail = lk.peerEmail
  const groupName = lk.groupName
  const groupMembers = [...lk.groupMembers]
  const isGroupCall = Boolean(lk.groupName)
  const callEvents = [...lk.events]
  lkLogEvent('Call ended')

  if (lk.room) {
    try { lk.room.disconnect() } catch {}
    lk.room = null
  }
  lk.isConnected = false
  lk.isScreenSharing = false
  lk.screenTrack = null
  lk.recording = false
  lk.localRecorder = null
  lk.remoteRecorder = null
  lk.localChunks = []
  lk.remoteChunks = []
  lk.callStartTime = null
  lk.peerName = ''
  lk.peerEmail = ''
  lk.groupName = ''
  lk.groupMembers = []
  lk.events = []

  // Clear grid
  const grid = $('lkVideoGrid')
  if (grid) grid.innerHTML = ''
  lkUpdateGridLayout()

  // Clear local PiP
  const localVid = $('localVideo')
  if (localVid) localVid.srcObject = null

  const selfAvatar = $('lkSelfAvatar')
  if (selfAvatar) selfAvatar.classList.add('hidden')

  $('videoModal').classList.add('hidden')
  $('incomingCallModal').classList.add('hidden')

  // Reset controls
  const muteBtn = $('muteBtn')
  if (muteBtn) { muteBtn.classList.remove('active'); setControlLabel(muteBtn, 'Mute') }
  const camBtn = $('cameraBtn')
  if (camBtn) { camBtn.classList.remove('active'); setControlLabel(camBtn, 'Camera') }
  const ssBtn = $('screenShareBtn')
  if (ssBtn) { ssBtn.classList.remove('sharing'); setControlLabel(ssBtn, 'Share') }

  // Prompt summary after call ends
  if (wasRecording && (localRecorder || lk.remoteRecorder)) {
    const stopPromises = []
    if (localRecorder) stopPromises.push(stopRecorderAsync(localRecorder))
    if (lk.remoteRecorder) stopPromises.push(stopRecorderAsync(lk.remoteRecorder))
    
    Promise.all(stopPromises).then(() => {
      const localBlob = localChunks.length
        ? new Blob(localChunks, { type: localChunks[0]?.type || 'audio/webm' })
        : null
      const remoteBlob = lk.remoteChunks && lk.remoteChunks.length
        ? new Blob(lk.remoteChunks, { type: lk.remoteChunks[0]?.type || 'audio/webm' })
        : null

      if (localBlob || remoteBlob) {
        if (isGroupCall) {
          promptGroupCallSummary(groupName, groupMembers, callStartTime, localBlob, remoteBlob, callEvents)
        } else {
          promptCallSummaryEmail(peerName, peerEmail, callStartTime, localBlob, remoteBlob, callEvents)
        }
      }
      
      // Cleanup WebAudio context
      if (lk.remoteAudioCtx) {
        try { lk.remoteAudioCtx.close() } catch (err) {}
        lk.remoteAudioCtx = null
        lk.remoteAudioDest = null
      }
    })
  }
}

// ── Group Call Setup Modal ─────────────────────────────────────────

let gcSelectedUsers = new Set()

function openGroupCallModal() {
  gcSelectedUsers = new Set()
  renderGroupCallUserList('')
  $('groupCallSearch').value = ''
  $('groupCallModal').classList.remove('hidden')
}

function renderGroupCallUserList(query) {
  const list = $('groupCallUserList')
  if (!list) return

  const q = query.toLowerCase()
  const users = state.users.filter(u =>
    u.id !== state.session?.id &&
    (u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
  )

  if (users.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:18px;font-size:13px;">No users found</p>'
    return
  }

  list.innerHTML = ''
  users.forEach(u => {
    const item = document.createElement('div')
    item.className = 'gc-user-item' + (gcSelectedUsers.has(u.id) ? ' selected' : '')
    item.dataset.uid = u.id

    const av = document.createElement('div')
    av.className = 'gc-user-avatar'
    av.textContent = initials(u.username)

    const name = document.createElement('div')
    name.className = 'gc-user-name'
    name.textContent = u.username

    const check = document.createElement('div')
    check.className = 'gc-user-check'
    check.textContent = gcSelectedUsers.has(u.id) ? '✓' : ''

    item.appendChild(av)
    item.appendChild(name)
    item.appendChild(check)

    item.addEventListener('click', () => {
      if (gcSelectedUsers.has(u.id)) {
        gcSelectedUsers.delete(u.id)
        item.classList.remove('selected')
        check.textContent = ''
      } else {
        gcSelectedUsers.add(u.id)
        item.classList.add('selected')
        check.textContent = '✓'
      }
    })

    list.appendChild(item)
  })
}

$('groupCallSearch')?.addEventListener('input', e => {
  renderGroupCallUserList(e.target.value)
})

$('groupCallCancelBtn')?.addEventListener('click', () => {
  $('groupCallModal').classList.add('hidden')
})

$('groupCallStartBtn')?.addEventListener('click', async () => {
  $('groupCallModal').classList.add('hidden')

  const targetIds = [...gcSelectedUsers]
  const roomName = 'room-' + Math.random().toString(36).slice(2, 10)

  // Send invite via WebSocket signaling to all selected participants
  const participantNames = targetIds.map(tid => {
    const u = state.users.find(u => u.id === tid)
    return u ? u.username : String(tid)
  })

  sendCallSignal({
    type: 'call_invite',
    target_ids: targetIds,
    room_name: roomName,
    participant_names: participantNames
  })

  // Join room ourselves
  const peerName = participantNames.join(', ')
  await lkJoinRoom(roomName, peerName, '')
})

$('startGroupCallBtn')?.addEventListener('click', async () => {
  if (!state.session) { showToast('Please log in first', 2500); return }
  if (lk.isConnected) { showToast('Already in a call', 2500); return }

  // If we're inside a group chat, auto-dial all members — no modal needed
  if (state.selectedGroup) {
    const group = state.selectedGroup
    const targetIds = group.members
      .filter(m => m.id !== state.session.id)
      .map(m => m.id)
    const participantNames = group.members
      .filter(m => m.id !== state.session.id)
      .map(m => m.username)
    const roomName = `group-${group.id}`

    showToast(`📹 Starting group call in "${group.name}"…`, 3000)

    sendCallSignal({
      type: 'call_invite',
      target_ids: targetIds,
      room_name: roomName,
      participant_names: participantNames,
      group_name: group.name
    })

    await lkJoinRoom(roomName, participantNames.join(', '), '')
    return
  }

  // Fallback: open the manual group-call modal
  openGroupCallModal()
})

// ── 1-on-1 video call (also uses LiveKit) ─────────────────────────

document.querySelectorAll('[data-video-call]').forEach(button => {
  button.addEventListener('click', async () => {
    if (!state.session) return
    if (lk.isConnected) { showToast('Already in a call', 2500); return }

    // ── Group chat: auto-call all group members ──────────────────────
    if (state.selectedGroup) {
      const group = state.selectedGroup
      const targetIds = group.members
        .filter(m => m.id !== state.session.id)
        .map(m => m.id)
      const participantNames = group.members
        .filter(m => m.id !== state.session.id)
        .map(m => m.username)
      const roomName = `group-${group.id}`

      showToast(`📹 Starting group call in "${group.name}"…`, 3000)

      sendCallSignal({
        type: 'call_invite',
        target_ids: targetIds,
        room_name: roomName,
        participant_names: participantNames,
        group_name: group.name
      })

      await lkJoinRoom(roomName, participantNames.join(', '), '')
      return
    }

    // ── 1-on-1 call ──────────────────────────────────────────────────
    if (!state.selected) return
    const peerUser = state.selected
    const roomName = [state.session.id, peerUser.id].sort().join('-')

    sendCallSignal({
      type: 'call_invite',
      target_id: peerUser.id,
      target_ids: [peerUser.id],
      room_name: roomName,
      participant_names: [peerUser.username]
    })

    await lkJoinRoom(roomName, peerUser.username, peerUser.email || '')
  })
})

document.querySelectorAll('[data-voice-call]').forEach(button => {
  button.addEventListener('click', async () => {
    if (!state.selected || !state.session) return
    if (lk.isConnected) { showToast('Already in a call', 2500); return }

    const peerUser = state.selected
    const roomName = [state.session.id, peerUser.id].sort().join('-')

    sendCallSignal({
      type: 'call_invite',
      target_id: peerUser.id,
      target_ids: [peerUser.id],
      room_name: roomName,
      participant_names: [peerUser.username]
    })

    await lkJoinRoom(roomName, peerUser.username, peerUser.email || '')
  })
})

// ── Incoming call handling ─────────────────────────────────────────

// Store pending room invite
let pendingRoomName = null
let pendingCallerName = ''

async function handleCallSignal(data) {
  if (!CALL_TYPES.has(data.type)) return false

  // ── call_invite: someone is inviting us to a LiveKit room ──────
  if (data.type === 'call_invite') {
    if (lk.isConnected) {
      showToast(`📞 ${data.sender_username || 'Someone'} is calling (busy)`, 3000)
      return true
    }
    pendingRoomName = data.room_name
    pendingCallerName = data.sender_username || 'Unknown'

    const participantList = (data.participant_names || []).filter(n => n !== state.session?.username)
    const isGroup = participantList.length > 1 || Boolean(data.group_name)
    const groupLabel = data.group_name ? `"${data.group_name}"` : null

    const callLabel = $('incomingCallLabel')
    const callHint = $('incomingCallHint')
    if (callLabel) callLabel.textContent = isGroup ? 'INCOMING GROUP CALL' : 'INCOMING VIDEO CALL'
    if (callHint) callHint.textContent = isGroup
      ? groupLabel
        ? `${pendingCallerName} is calling from group ${groupLabel}`
        : `${pendingCallerName} + ${participantList.length} others – Relay SFU`
      : `From ${pendingCallerName} – Relay powered by LiveKit`

    // Show group name in avatar area for group calls
    $('incomingCallName').textContent = isGroup && groupLabel ? groupLabel : pendingCallerName
    $('incomingCallAvatar').textContent = isGroup ? '👥' : initials(pendingCallerName)
    $('incomingCallModal').classList.remove('hidden')
    startRingtone()

    const toastMsg = isGroup && groupLabel
      ? `📹 ${pendingCallerName} is calling from group ${groupLabel}`
      : `📞 Incoming call from ${pendingCallerName}`
    showToast(toastMsg, 8000)

    if (window.Notification && Notification.permission === 'granted') {
      try {
        new Notification(isGroup && groupLabel ? `Group call – ${groupLabel}` : `Incoming call from ${pendingCallerName}`, {
          body: isGroup
            ? `${pendingCallerName} is inviting you to a group call${ groupLabel ? ` in ${groupLabel}` : '' }`
            : 'Incoming video/voice call',
          icon: '/static/icons/call-icon.png'
        })
      } catch (e) {}
    }
    return true
  }

  // ── call_leave: someone left the room ─────────────────────────
  if (data.type === 'call_leave') {
    showToast(`👋 ${data.sender_username || 'Participant'} left the room`, 2500)
    return true
  }

  // ── Legacy P2P signals (call_offer, call_answer, call_ice, call_reject, call_end)
  if (data.type === 'call_offer') {
    if (call.inCall || lk.isConnected) {
      sendCallSignal({ type: 'call_reject', target_id: data.sender_id })
      return true
    }
    call.incomingOffer = data.sdp
    call.peerId = data.sender_id
    call.peerName = callerName(data.sender_id, data.sender_username)
    call.peerEmail = callerEmail(data.sender_id, data.sender_email)
    $('incomingCallName').textContent = call.peerName
    $('incomingCallAvatar').textContent = initials(call.peerName)
    $('incomingCallModal').classList.remove('hidden')
    startRingtone()
    showToast(`📞 Incoming call from ${call.peerName}`, 6000)
    return true
  }

  if (data.type === 'call_answer') {
    if (call.pc && data.sdp && call.pc.signalingState === 'have-local-offer') {
      if (data.sender_username && !call.peerName) call.peerName = data.sender_username
      await call.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
      await flushIce()
    }
    return true
  }

  if (data.type === 'call_ice') {
    if (!data.candidate) return true
    if (call.pc && call.pc.remoteDescription) {
      try { await call.pc.addIceCandidate(data.candidate) } catch {}
    } else {
      call.pendingIce.push(data.candidate)
    }
    return true
  }

  if (data.type === 'call_reject' || data.type === 'call_end') {
    stopRingtone()
    $('incomingCallModal').classList.add('hidden')
    const wasIncoming = Boolean(call.incomingOffer) || Boolean(pendingRoomName)
    pendingRoomName = null
    pendingCallerName = ''
    endCall()
    if (data.type === 'call_reject' && !wasIncoming) showToast('Call declined', 3000)
    return true
  }

  return true
}

// ── Accept / Reject incoming ───────────────────────────────────────

$('acceptCallBtn').addEventListener('click', async () => {
  stopRingtone()
  $('incomingCallModal').classList.add('hidden')

  // LiveKit invite → join room
  if (pendingRoomName) {
    const rn = pendingRoomName
    const cn = pendingCallerName
    pendingRoomName = null
    pendingCallerName = ''
    await lkJoinRoom(rn, cn, '')
    return
  }

  // Legacy P2P accept
  try {
    const pc = createPeerConnection()
    await pc.setRemoteDescription({ type: 'offer', sdp: call.incomingOffer })
    await flushIce()
    await attachLocalMedia(pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    sendCallSignal({ type: 'call_answer', sdp: pc.localDescription.sdp, target_id: call.peerId })
    call.inCall = true
    call.incomingOffer = null
    showCallStage(call.peerName, 'Connecting…')
  } catch (error) {
    endCall()
    showToast(`❌ ${error.message}`, 4000)
  }
})

$('rejectCallBtn').addEventListener('click', () => {
  stopRingtone()
  if (pendingRoomName) {
    sendCallSignal({ type: 'call_reject', room_name: pendingRoomName })
    pendingRoomName = null
    pendingCallerName = ''
    $('incomingCallModal').classList.add('hidden')
    return
  }
  sendCallSignal({ type: 'call_reject', target_id: call.peerId })
  call.incomingOffer = null
  $('incomingCallModal').classList.add('hidden')
})

// ── Controls ───────────────────────────────────────────────────────

$('muteBtn').addEventListener('click', async () => {
  if (lk.room) {
    const enabled = lk.room.localParticipant.isMicrophoneEnabled
    await lk.room.localParticipant.setMicrophoneEnabled(!enabled)
    $('muteBtn').classList.toggle('active', enabled)
    setControlLabel($('muteBtn'), !enabled ? 'Mute' : 'Unmute')
    return
  }
  // Legacy P2P
  const track = call.localStream?.getAudioTracks()[0]
  if (!track) return
  track.enabled = !track.enabled
  $('muteBtn').classList.toggle('active', !track.enabled)
  setControlLabel($('muteBtn'), track.enabled ? 'Mute' : 'Unmute')
  logCallEvent(track.enabled ? 'Microphone unmuted' : 'Microphone muted')
})

$('cameraBtn').addEventListener('click', async () => {
  if (lk.room) {
    const enabled = lk.room.localParticipant.isCameraEnabled
    await lk.room.localParticipant.setCameraEnabled(!enabled)
    $('cameraBtn').classList.toggle('active', enabled)
    setControlLabel($('cameraBtn'), !enabled ? 'Camera' : 'Camera On')
    // Toggle PiP avatar
    const selfAvatar = $('lkSelfAvatar')
    const localVid = $('localVideo')
    if (selfAvatar) {
      if (!enabled) {
        selfAvatar.textContent = lkInitials(state.session?.username)
        selfAvatar.classList.remove('hidden')
        if (localVid) localVid.style.display = 'none'
      } else {
        selfAvatar.classList.add('hidden')
        if (localVid) localVid.style.display = ''
      }
    }
    return
  }
  // Legacy P2P
  const track = call.localStream?.getVideoTracks()[0]
  if (!track) return
  track.enabled = !track.enabled
  $('cameraBtn').classList.toggle('active', !track.enabled)
  setControlLabel($('cameraBtn'), track.enabled ? 'Camera' : 'Camera On')
  logCallEvent(track.enabled ? 'Camera enabled' : 'Camera disabled')
})

$('screenShareBtn')?.addEventListener('click', async () => {
  if (!lk.room) {
    showToast('Screen sharing is only available in LiveKit calls', 3000)
    return
  }

  if (lk.isScreenSharing) {
    // Stop screen share
    if (lk.screenTrack) {
      await lk.room.localParticipant.unpublishTrack(lk.screenTrack)
      lk.screenTrack.stop()
      lk.screenTrack = null
    }
    lk.isScreenSharing = false
    $('screenShareBtn').classList.remove('sharing')
    setControlLabel($('screenShareBtn'), 'Share')
    lkLogEvent('Screen share stopped')
  } else {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const screenVideoTrack = screenStream.getVideoTracks()[0]
      const livekitTrack = await lk.room.localParticipant.publishTrack(screenVideoTrack, {
        source: LivekitClient.Track.Source.ScreenShare
      })
      lk.screenTrack = screenVideoTrack
      lk.isScreenSharing = true
      $('screenShareBtn').classList.add('sharing')
      setControlLabel($('screenShareBtn'), 'Stop Share')
      lkLogEvent('Screen share started')

      // Auto-stop when user clicks browser's "stop sharing"
      screenVideoTrack.onended = async () => {
        lk.isScreenSharing = false
        lk.screenTrack = null
        $('screenShareBtn').classList.remove('sharing')
        setControlLabel($('screenShareBtn'), 'Share')
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        showToast(`❌ Screen share failed: ${err.message}`, 4000)
      }
    }
  }
})

$('endCallBtn').addEventListener('click', () => {
  if (lk.isConnected || lk.room) {
    lkEndCall()
    return
  }
  // Legacy P2P
  sendCallSignal({ type: 'call_end', target_id: call.peerId })
  endCall()
})

// ── Legacy P2P helpers (kept for fallback) ─────────────────────────

function callerName(userId, fallbackUsername) {
  return (
    fallbackUsername ||
    state.users.find(user => user.id === userId)?.username ||
    (state.selected?.id === userId ? state.selected.username : '') ||
    'Unknown'
  )
}

function callerEmail(userId, fallbackEmail) {
  return (
    fallbackEmail ||
    state.users.find(user => user.id === userId)?.email ||
    (state.selected?.id === userId ? state.selected.email : '') ||
    ''
  )
}

function setCallStatus(text) {
  const status = $('callStatusText')
  if (status) status.textContent = text
}

function setCallButtonsBusy(busy) {
  document.querySelectorAll('[data-video-call]').forEach(button => {
    button.classList.toggle('in-call', busy)
  })
}

function showCallStage(peerName, statusText) {
  setCallStatus(statusText)
  $('remotePlaceholder').classList.remove('hidden')
  $('videoModal').classList.remove('hidden')
  setCallButtonsBusy(true)
}

function setControlLabel(button, label) {
  const span = button.querySelector('span')
  if (span) span.textContent = label
}

async function flushIce() {
  if (!call.pc || !call.pc.remoteDescription) return
  while (call.pendingIce.length) {
    const candidate = call.pendingIce.shift()
    try { await call.pc.addIceCandidate(candidate) } catch {}
  }
}

function createPeerConnection() {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  call.pc = pc

  const remoteAudioStream = new MediaStream()
  const remoteVideoStream = new MediaStream()
  const remoteAudio = $('remoteAudio')
  const remoteVideo = $('remoteVideo')
  if (remoteAudio) remoteAudio.srcObject = remoteAudioStream
  if (remoteVideo) remoteVideo.srcObject = remoteVideoStream

  function tryPlay(el, label) {
    el.play().catch(err => console.warn(`[P2P] ${label}.play() blocked:`, err.name))
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendCallSignal({ type: 'call_ice', candidate: event.candidate.toJSON() })
    }
  }

  pc.ontrack = event => {
    const { track } = event
    const isAudio = track.kind === 'audio'
    const stream = isAudio ? remoteAudioStream : remoteVideoStream
    const el = isAudio ? remoteAudio : remoteVideo
    if (!stream.getTracks().includes(track)) stream.addTrack(track)
    if (el) tryPlay(el, isAudio ? 'remoteAudio' : 'remoteVideo')
    track.addEventListener('unmute', () => {
      if (el) tryPlay(el, isAudio ? 'remoteAudio' : 'remoteVideo')
      if (!isAudio) $('remotePlaceholder')?.classList.add('hidden')
      setCallStatus('Live')
    })
    if (!isAudio) $('remotePlaceholder')?.classList.add('hidden')
    setCallStatus('Live')
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setCallStatus('Live')
      if (remoteAudio) tryPlay(remoteAudio, 'remoteAudio')
      if (remoteVideo) tryPlay(remoteVideo, 'remoteVideo')
    }
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      if (call.inCall) endCall()
    }
  }

  pc.oniceconnectionstatechange = () => {
    if (
      (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') &&
      !call.recording
    ) {
      logCallEvent('Call connected (ICE)', { peer: call.peerName })
      startCallRecording()
    }
  }

  return pc
}

function createAvatarVideoTrack(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let step = 0
  const userInitials = initials(name || 'You')
  function draw() {
    step++
    const bgGrad = ctx.createRadialGradient(320, 240, 40, 320, 240, 380)
    bgGrad.addColorStop(0, '#1e2538'); bgGrad.addColorStop(1, '#0c1017')
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, 640, 480)
    const pulse = Math.sin(step * 0.08) * 5
    ctx.beginPath(); ctx.arc(320, 200, 78 + pulse + 14, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(99,102,241,0.22)'; ctx.fill()
    const avatarGrad = ctx.createLinearGradient(240, 120, 400, 280)
    avatarGrad.addColorStop(0, '#6366f1'); avatarGrad.addColorStop(1, '#8b5cf6')
    ctx.beginPath(); ctx.arc(320, 200, 78, 0, Math.PI * 2)
    ctx.fillStyle = avatarGrad; ctx.fill()
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(userInitials, 320, 200)
  }
  draw()
  const intervalId = setInterval(draw, 100)
  const stream = canvas.captureStream ? canvas.captureStream(10) : null
  if (!stream) return null
  const track = stream.getVideoTracks()[0]
  if (track) {
    const origStop = track.stop.bind(track)
    track.stop = () => { clearInterval(intervalId); origStop() }
  }
  return track
}

function createSilentAudioTrack() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const dst = ctx.createMediaStreamDestination()
    osc.connect(dst); osc.start()
    const track = dst.stream.getAudioTracks()[0]
    if (track) {
      track.enabled = false
      const origStop = track.stop.bind(track)
      track.stop = () => { try { osc.stop() } catch {} try { ctx.close() } catch {} origStop() }
      return track
    }
  } catch {}
  return null
}

async function getLocalStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('WebRTC media devices not supported in this browser.')
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: true })
    call.isAvatarFallback = false; return stream
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      throw new Error('Microphone or camera permission was denied.')
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    call.isAvatarFallback = false; return stream
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      throw new Error('Microphone or camera permission was denied.')
  }
  let audioTrack = null, videoTrack = null
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); audioTrack = s.getAudioTracks()[0] } catch {}
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); videoTrack = s.getVideoTracks()[0] } catch {}
  if (!audioTrack && !videoTrack) {
    const fv = createAvatarVideoTrack(state.session?.username || 'You')
    const fa = createSilentAudioTrack()
    if (fv && fa) { call.isAvatarFallback = true; showToast('⚠️ No camera or mic. Connecting in preview mode.', 4500); return new MediaStream([fa, fv]) }
    throw new Error('No camera or microphone found.')
  }
  const combined = new MediaStream()
  if (audioTrack) combined.addTrack(audioTrack)
  else { const s = createSilentAudioTrack(); if (s) combined.addTrack(s) }
  if (videoTrack) { call.isAvatarFallback = false; combined.addTrack(videoTrack) }
  else {
    call.isAvatarFallback = true
    const av = createAvatarVideoTrack(state.session?.username || 'You')
    if (av) combined.addTrack(av)
  }
  return combined
}

async function attachLocalMedia(pc) {
  call.localStream = await getLocalStream()
  const localVid = $('localVideo')
  if (localVid) {
    localVid.srcObject = call.localStream
    localVid.classList.toggle('unmirrored', Boolean(call.isAvatarFallback))
  }
  call.localStream.getTracks().forEach(track => pc.addTrack(track, call.localStream))
}

// ── Legacy P2P startOutgoingCall (fallback if LiveKit not available) ─
async function startOutgoingCall() {
  if (!state.selected || call.inCall) return
  try {
    call.peerId = state.selected.id
    call.peerName = state.selected.username
    call.peerEmail = state.selected.email || ''
    call.pendingIce = []
    const pc = createPeerConnection()
    await attachLocalMedia(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendCallSignal({ type: 'call_offer', sdp: pc.localDescription.sdp, target_id: call.peerId })
    call.inCall = true
    showCallStage(call.peerName, `Calling ${call.peerName}…`)
  } catch (error) {
    endCall()
    showToast(`❌ ${error.message}`, 4000)
  }
}

// ── Call Recording & Transcription ────────────────────────────────

function bestMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || ''
}

function startCallRecording() {
  if (call.recording) return
  const mime = bestMimeType()
  call.localChunks = []; call.remoteChunks = []
  call.callStartTime = new Date().toISOString()
  call.recording = true
  logCallEvent('Recording started')
  logCallEvent('Participant joined', { participant: state.session?.username })
  logCallEvent('Participant joined', { participant: call.peerName })

  if (call.localStream) {
    const localAudio = new MediaStream(call.localStream.getAudioTracks())
    if (localAudio.getTracks().length) {
      try {
        call.localRecorder = new MediaRecorder(localAudio, mime ? { mimeType: mime } : {})
        call.localRecorder.ondataavailable = e => { if (e.data?.size > 0) call.localChunks.push(e.data) }
        call.localRecorder.start(1000)
      } catch {}
    }
  }

  const remoteAudioEl = $('remoteAudio')
  if (remoteAudioEl?.srcObject) {
    const remoteStream = new MediaStream(remoteAudioEl.srcObject.getAudioTracks())
    if (remoteStream.getTracks().length) {
      try {
        call.remoteRecorder = new MediaRecorder(remoteStream, mime ? { mimeType: mime } : {})
        call.remoteRecorder.ondataavailable = e => { if (e.data?.size > 0) call.remoteChunks.push(e.data) }
        call.remoteRecorder.start(1000)
      } catch {}
    }
  }
}

function stopRecorderAsync(recorder) {
  return new Promise(resolve => {
    if (!recorder || recorder.state === 'inactive') { resolve(); return }
    recorder.onstop = () => resolve()
    try { recorder.stop() } catch { resolve() }
  })
}

function logCallEvent(eventName, detail = {}) {
  call.events.push({ time: new Date().toISOString(), event: eventName, participant: state.session?.username || 'Me', ...detail })
}

function promptCallSummaryEmail(peerName, peerEmail, startTime, localBlob, remoteBlob, events) {
  const myName = state.session?.username || 'Me'
  const myEmail = state.session?.email || ''
  const recName = peerName || 'Receiver'
  const recEmail = peerEmail || (state.users.find(u => u.username === peerName)?.email) || ''

  $('optReceiverName').textContent = recName
  $('optReceiverEmail').textContent = recEmail ? `(${recEmail})` : '(No email set)'
  $('optSenderName').textContent = `${myName} (Me)`
  $('optSenderEmail').textContent = myEmail ? `(${myEmail})` : '(No email set)'
  $('summaryEmailModal').classList.remove('hidden')

  const handleSend = () => {
    cleanup()
    const selectedOpt = document.querySelector('input[name="summaryRecipient"]:checked')?.value || 'receiver'
    let targetEmail = ''
    if (selectedOpt === 'receiver') targetEmail = recEmail || myEmail
    else if (selectedOpt === 'sender') targetEmail = myEmail
    else if (selectedOpt === 'custom') targetEmail = $('optCustomEmailInput').value.trim() || myEmail
    submitCallSummary(peerName, recEmail, targetEmail, startTime, localBlob, remoteBlob, events)
  }

  const handleSkip = () => { cleanup(); showToast('Call summary skipped', 3000) }

  function cleanup() {
    $('summaryEmailModal').classList.add('hidden')
    $('summarySendBtn').removeEventListener('click', handleSend)
    $('summaryCancelBtn').removeEventListener('click', handleSkip)
  }

  $('summarySendBtn').addEventListener('click', handleSend)
  $('summaryCancelBtn').addEventListener('click', handleSkip)
}

async function submitCallSummary(peerName, peerEmail, targetEmail, startTime, localBlob, remoteBlob, events) {
  if (!state.session) return
  showToast('📝 Transcribing call…', 6000)
  const myEmail = state.session?.email || ''
  const fd = new FormData()
  const mimeType = localBlob?.type || remoteBlob?.type || 'audio/webm'
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  if (localBlob?.size > 0) fd.append('local_audio', localBlob, `local.${ext}`)
  if (remoteBlob?.size > 0) fd.append('remote_audio', remoteBlob, `remote.${ext}`)
  fd.append('peer_name', peerName || 'Unknown')
  fd.append('my_name', state.session?.username || 'Me')
  fd.append('caller_email', myEmail)
  fd.append('receiver_email', peerEmail || '')
  fd.append('target_email', targetEmail || peerEmail || myEmail)
  fd.append('caller_email', myEmail)
  fd.append('receiver_email', peerEmail || '')
  fd.append('target_email', targetEmail || peerEmail || myEmail)
  fd.append('call_start', startTime || new Date().toISOString())
  fd.append('call_end', new Date().toISOString())
  fd.append('call_events', JSON.stringify(events || []))
  try {
    const res = await fetch('/api/call-summary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.session.access_token}` },
      body: fd
    })
    if (res.ok) showToast('✅ Call summary sent to n8n!', 4000)
    else {
      const err = await res.json().catch(() => ({}))
      showToast(`⚠️ Summary failed: ${err.detail || res.status}`, 5000)
    }
  } catch (e) {
    showToast('⚠️ Could not send call summary.', 4000)
  }
}

function endCall() {
  const pc = call.pc
  call.pc = null; call.inCall = false
  if (pc) pc.close()

  const wasRecording = call.recording
  const localRecorder = call.localRecorder
  const remoteRecorder = call.remoteRecorder
  const localChunks = call.localChunks
  const remoteChunks = call.remoteChunks
  const callStartTime = call.callStartTime
  const peerName = call.peerName
  const peerEmail = call.peerEmail
  const callEvents = [...call.events]

  if (call.localStream) { call.localStream.getTracks().forEach(t => t.stop()); call.localStream = null }

  const remoteAudio = $('remoteAudio'); if (remoteAudio) remoteAudio.srcObject = null
  const remoteVideo = $('remoteVideo'); if (remoteVideo) remoteVideo.srcObject = null
  const localVid = $('localVideo'); if (localVid) { localVid.srcObject = null; localVid.classList.remove('unmirrored') }
  $('remotePlaceholder')?.classList.remove('hidden')
  setCallButtonsBusy(false)
  $('muteBtn').classList.remove('active'); $('cameraBtn').classList.remove('active')
  setControlLabel($('muteBtn'), 'Mute'); setControlLabel($('cameraBtn'), 'Camera')

  call.inCall = false; call.incomingOffer = null; call.peerId = null; call.peerName = ''
  call.peerEmail = ''; call.pendingIce = []; call.isAvatarFallback = false
  call.localRecorder = null; call.remoteRecorder = null; call.localChunks = []; call.remoteChunks = []
  call.callStartTime = null; call.recording = false; call.events = []

  $('videoModal').classList.add('hidden')
  $('incomingCallModal').classList.add('hidden')

  if (wasRecording) {
    callEvents.push({ time: new Date().toISOString(), event: 'Call ended', participant: state.session?.username || 'Me' })
    Promise.all([stopRecorderAsync(localRecorder), stopRecorderAsync(remoteRecorder)]).then(() => {
      const localBlob = localChunks.length ? new Blob(localChunks, { type: localChunks[0]?.type || 'audio/webm' }) : null
      const remoteBlob = remoteChunks.length ? new Blob(remoteChunks, { type: remoteChunks[0]?.type || 'audio/webm' }) : null
      if (localBlob || remoteBlob) {
        promptCallSummaryEmail(peerName, peerEmail, callStartTime, localBlob, remoteBlob, callEvents)
      }
    })
  }
}

// ═══════════════════════════════════════════════════════════════════
//  GROUP VIDEO CALL SUMMARIZATION
// ═══════════════════════════════════════════════════════════════════

function promptGroupCallSummary(groupName, groupMembers, callStartTime, localBlob, remoteBlob, callEvents) {
  const modal = document.getElementById('groupSummaryModal')
  if (!modal) {
    submitGroupCallSummary(groupName, groupMembers, callStartTime, localBlob, remoteBlob, callEvents, null)
    return
  }

  const nameEl = document.getElementById('gsSummaryGroupName')
  if (nameEl) nameEl.textContent = groupName || 'Group Call'

  const memberEl = document.getElementById('gsSummaryMembers')
  if (memberEl) {
    memberEl.textContent = groupMembers.map(function(m){ return m.username }).join(', ') || 'Unknown participants'
  }

  document.getElementById('gsSummaryBody').innerHTML = ''
  document.getElementById('gsSummaryLoading').classList.remove('hidden')
  document.getElementById('gsSummaryContent').classList.add('hidden')
  document.getElementById('gsSummarySendBtn').disabled = true

  modal.classList.remove('hidden')

  submitGroupCallSummary(groupName, groupMembers, callStartTime, localBlob, remoteBlob, callEvents, function(result) {
    document.getElementById('gsSummaryLoading').classList.add('hidden')
    document.getElementById('gsSummaryContent').classList.remove('hidden')
    document.getElementById('gsSummarySendBtn').disabled = false

    const body = document.getElementById('gsSummaryBody')
    if (result && result.summary) {
      body.innerHTML = formatGroupSummary(result.summary, result)
    } else if (result && result.transcript) {
      body.innerHTML = '<div class="gs-section"><div class="gs-section-title">Transcript</div><div class="gs-transcript">' + gsEscape(result.transcript) + '</div></div>'
    } else {
      body.innerHTML = '<p class="gs-error">Could not generate summary. Recording may be too short or silent.</p>'
    }
  })
}

function formatGroupSummary(summary, result) {
  var parsed = null
  try { parsed = JSON.parse(summary) } catch(e) {}

  if (parsed && typeof parsed === 'object') {
    var sections = []
    if (parsed.summary || parsed.overview)
      sections.push('<div class="gs-section"><div class="gs-section-title">Overview</div><div class="gs-text">' + gsEscape(parsed.summary || parsed.overview) + '</div></div>')
    if (parsed.key_points && parsed.key_points.length)
      sections.push('<div class="gs-section"><div class="gs-section-title">Key Points</div><ul class="gs-list">' + parsed.key_points.map(function(p){ return '<li>'+gsEscape(p)+'</li>' }).join('') + '</ul></div>')
    if (parsed.action_items && parsed.action_items.length)
      sections.push('<div class="gs-section"><div class="gs-section-title">Action Items</div><ul class="gs-list gs-actions">' + parsed.action_items.map(function(a){ return '<li>'+gsEscape(typeof a==='string'?a:(a.task||JSON.stringify(a)))+'</li>' }).join('') + '</ul></div>')
    if (parsed.decisions && parsed.decisions.length)
      sections.push('<div class="gs-section"><div class="gs-section-title">Decisions</div><ul class="gs-list">' + parsed.decisions.map(function(d){ return '<li>'+gsEscape(d)+'</li>' }).join('') + '</ul></div>')
    var tx = (parsed.full_transcript || (result && result.transcript))
    if (tx)
      sections.push('<details class="gs-details"><summary>Full Transcript</summary><div class="gs-transcript">'+gsEscape(tx)+'</div></details>')
    return sections.join('') || '<div class="gs-text">' + gsEscape(summary) + '</div>'
  }

  var txPart = (result && result.transcript) ? '<details class="gs-details"><summary>Full Transcript</summary><div class="gs-transcript">'+gsEscape(result.transcript)+'</div></details>' : ''
  return '<div class="gs-section"><div class="gs-section-title">Summary</div><div class="gs-text">' + gsEscape(summary) + '</div></div>' + txPart
}

function gsEscape(str) {
  if (!str) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function submitGroupCallSummary(groupName, groupMembers, callStartTime, localBlob, remoteBlob, callEvents, onResult) {
  if (!state.session) { if (onResult) onResult(null); return }

  showToast('Generating group call summary...', 5000)

  const myEmail = state.session && state.session.email ? state.session.email : ''
  const memberEmails = groupMembers.map(function(m){ return m.email || '' }).filter(Boolean)
  const memberNames  = groupMembers.map(function(m){ return m.username }).join(', ')

  const fd = new FormData()
  let mimeType = (localBlob && localBlob.type) ? localBlob.type : (remoteBlob && remoteBlob.type) ? remoteBlob.type : 'audio/webm'
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  if (localBlob && localBlob.size > 0) fd.append('local_audio', localBlob, 'group_local.' + ext)
  if (remoteBlob && remoteBlob.size > 0) fd.append('remote_audio', remoteBlob, 'group_remote.' + ext)
  fd.append('group_name',     groupName || 'Group Call')
  fd.append('my_name',        (state.session && state.session.username) ? state.session.username : 'Me')
  fd.append('member_names',   memberNames)
  fd.append('member_emails',  JSON.stringify(memberEmails))
  fd.append('caller_email',   myEmail)
  fd.append('call_start',     callStartTime || new Date().toISOString())
  fd.append('call_end',       new Date().toISOString())
  fd.append('call_events',    JSON.stringify(callEvents || []))


  try {
    const res = await fetch('/api/call-summary/group', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + state.session.access_token },
      body: fd
    })
    if (res.ok) {
      const data = await res.json()
      showToast('Group call summary ready!', 4000)
      if (onResult) onResult(data)
    } else {
      const err = await res.json().catch(function(){ return {} })
      showToast('Summary failed: ' + (err.detail || res.status), 5000)
      if (onResult) onResult(null)
    }
  } catch (e) {
    showToast('Could not generate group summary.', 4000)
    if (onResult) onResult(null)
  }
}

document.getElementById('gsCloseBtn') && document.getElementById('gsCloseBtn').addEventListener('click', function(){
  document.getElementById('groupSummaryModal') && document.getElementById('groupSummaryModal').classList.add('hidden')
})
document.getElementById('gsSummarySendBtn') && document.getElementById('gsSummarySendBtn').addEventListener('click', function(){
  showToast('Summary emailed to all group members!', 3500)
  document.getElementById('groupSummaryModal') && document.getElementById('groupSummaryModal').classList.add('hidden')
})
