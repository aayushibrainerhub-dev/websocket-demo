const state = {
  session: JSON.parse(localStorage.getItem('relay_session') || 'null'),
  socket: null,
  signalSocket: null,
  selected: null,
  users: [],
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


async function authenticate(path) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: $('username').value,
      password: $('password').value
    })
  })

  const data = await response.json()

  if (!response.ok) {

    if (
      path === '/register' &&
      response.status === 409
    ) {
      throw new Error(
        'This username already exists. Use Sign in instead.'
      )
    }

    throw new Error(
      data.detail || 'Authentication failed'
    )
  }

  state.session = data

  localStorage.setItem(
    'relay_session',
    JSON.stringify(data)
  )

  setView(true)

  $('profileName').textContent =
    data.username

  connectSignal()
  await loadUsers()
}


$('authForm').addEventListener(
  'submit',
  event => {

    event.preventDefault()

    authenticate('/login').catch(
      error => {
        $('authError').textContent =
          error.message
      }
    )
  }
)


$('registerButton').addEventListener(
  'click',
  () => {

    authenticate('/register').catch(
      error => {
        $('authError').textContent =
          error.message
      }
    )
  }
)


$('logoutButton').addEventListener(
  'click',
  () => {

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

    localStorage.removeItem(
      'relay_session'
    )

    setView(false)
  }
)


/* ============================================================
   USERS
============================================================ */

async function loadUsers() {

  const search =
    encodeURIComponent(
      $('userSearch').value.trim()
    )

  state.users =
    await request(
      `/api/users?search=${search}`
    )

  renderUsers()
}


function renderUsers() {

  const list =
    $('userList')

  list.innerHTML = ''

  if (!state.users.length) {

    list.innerHTML =
      '<p class="empty">No people found yet.</p>'

    return
  }

  state.users.forEach(user => {

    const button =
      document.createElement('button')

    button.className =
      `user-row ${state.selected?.id === user.id
        ? 'active'
        : ''
      }`

    const avatar =
      document.createElement('span')

    avatar.className =
      'avatar'

    avatar.textContent =
      initials(user.username)

    const details =
      document.createElement('span')

    const name =
      document.createElement('strong')

    name.textContent =
      user.username

    const subtitle =
      document.createElement('small')

    subtitle.textContent =
      'Direct message'

    details.append(
      name,
      subtitle
    )

    button.append(
      avatar,
      details
    )

    button.addEventListener(
      'click',
      () => openConversation(user)
    )

    list.appendChild(button)
  })
}


$('userSearch').addEventListener(
  'input',
  () => {
    loadUsers().catch(() => { })
  }
)


/* ============================================================
   CONVERSATION
============================================================ */

async function openConversation(user) {

  if (state.socket) {
    state.socket.close()
  }

  state.selected =
    user

  renderUsers()

  $('emptyConversation')
    .classList.add('hidden')

  $('activeConversation')
    .classList.remove('hidden')

  $('conversationName').textContent =
    user.username

  $('conversationAvatar').textContent =
    initials(user.username)

  $('connectionStatus').textContent =
    'Loading history...'

  $('messages').innerHTML = ''

  state.renderedMessageIds.clear()

  try {

    const history =
      await request(
        `/api/messages/${user.id}`
      )

    history.forEach(
      renderMessage
    )

    connect(user.id)

  } catch (error) {

    $('connectionStatus').textContent =
      error.message
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

  const peerInitials =
    initials(state.selected?.username)

  article.innerHTML = mine
    ? `<div class="bubble-row">
         <div class="bubble"></div>
       </div>
       <time>${date}</time>`
    : `<div class="bubble-row">
         <div class="person-avatar mini">${peerInitials}</div>
         <div class="bubble"></div>
       </div>
       <time>${date}</time>`

  article
    .querySelector('.bubble')
    .textContent =
    message.content

  $('messages')
    .appendChild(article)

  $('messages').scrollTop =
    $('messages').scrollHeight
}


$('messageForm').addEventListener(
  'submit',
  event => {

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

    state.socket.send(
      JSON.stringify({
        content
      })
    )

    input.value = ''
  }
)


/* ============================================================
   VOICE ASSISTANT STATE
============================================================ */

const voice = {

  state: 'idle',

  selectedUser: null,

  pendingMessage: null,

  searchResults: [],

  originalCommand: null,

  receiverName: null,

  awaitingUserSelection: false,

  awaitingConfirmation: false
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

  [
    'vStep1',
    'vStep2',
    'vStep3',
    'vStep4'
  ].forEach(
    (id, index) => {

      $(id).classList.toggle(
        'hidden',
        index !== n - 1
      )
    }
  )


  for (
    let i = 1;
    i <= 4;
    i++
  ) {

    const dot =
      $(`vDot${i}`)

    dot.classList.toggle(
      'active',
      i <= n
    )

    dot.classList.toggle(
      'done',
      i < n
    )
  }


  for (
    let i = 1;
    i <= 3;
    i++
  ) {

    $(`vLine${i}`)
      .classList.toggle(
        'active',
        i < n
      )
  }
}


function resetVoiceState() {

  voice.state =
    'idle'

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
        SINGLE USER / DIRECT CONFIRMATION
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
    user
  )


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

  /*
  Already connected to this user.
  */

  if (
    state.selected?.id ===
    receiver.id &&
    state.socket?.readyState ===
    WebSocket.OPEN
  ) {

    state.socket.send(
      JSON.stringify({
        content: message
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

  state.socket.send(
    JSON.stringify({
      content: message
    })
  )
}


/* ============================================================
   INITIAL SESSION
============================================================ */

if (state.session) {

  setView(true)

  $('profileName')
    .textContent =
    state.session.username

  connectSignal()

  loadUsers()
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
   VIDEO CALL (WebRTC live stream)
============================================================ */

const CALL_TYPES = new Set([
  'call_offer',
  'call_answer',
  'call_ice',
  'call_reject',
  'call_end'
])

const call = {
  pc: null,
  localStream: null,
  inCall: false,
  incomingOffer: null,
  peerId: null,
  peerName: '',
  pendingIce: [],
  isAvatarFallback: false,
  // Recording state
  localRecorder: null,
  remoteRecorder: null,
  localChunks: [],
  remoteChunks: [],
  callStartTime: null,
  recording: false,
  // Event log (sent to n8n for the OpenAI prompt's Important Events section)
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

  socket.onmessage = async event => {
    const data = JSON.parse(event.data)
    await handleCallSignal(data)
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
  const targetId = payload.target_id || call.peerId
  const message = JSON.stringify({
    ...payload,
    target_id: targetId
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
  }
}


function callerName(userId) {
  return (
    state.users.find(user => user.id === userId)?.username ||
    (state.selected?.id === userId ? state.selected.username : '') ||
    'Unknown'
  )
}


function setCallStatus(text) {
  const status = $('callStatusText')
  if (status) {
    status.textContent = text
  }
}


function setCallButtonsBusy(busy) {
  document.querySelectorAll('[data-video-call]').forEach(button => {
    button.classList.toggle('in-call', busy)
  })
}


function showCallStage(peerName, statusText) {
  $('callPeerName').textContent = peerName
  $('remoteCallAvatar').textContent = initials(peerName)
  setCallStatus(statusText)
  $('remotePlaceholder').classList.remove('hidden')
  $('videoModal').classList.remove('hidden')
  setCallButtonsBusy(true)
}


function setControlLabel(button, label) {
  const span = button.querySelector('span')
  if (span) {
    span.textContent = label
  }
}


async function flushIce() {
  if (!call.pc || !call.pc.remoteDescription) {
    return
  }

  while (call.pendingIce.length) {
    const candidate = call.pendingIce.shift()
    try {
      await call.pc.addIceCandidate(candidate)
    } catch { }
  }
}


function createPeerConnection() {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  call.pc = pc

  // Separate stable streams — audio → <audio>, video → <video>
  // This avoids Chrome's unreliable audio routing through video elements
  const remoteAudioStream = new MediaStream()
  const remoteVideoStream = new MediaStream()

  const remoteAudio = $('remoteAudio')
  const remoteVideo = $('remoteVideo')
  remoteAudio.srcObject = remoteAudioStream
  remoteVideo.srcObject = remoteVideoStream

  function tryPlay(el, label) {
    el.play().catch(err => {
      console.warn(`[WebRTC] ${label}.play() blocked:`, err.name, err.message)
    })
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendCallSignal({
        type: 'call_ice',
        candidate: event.candidate.toJSON()
      })
    }
  }

  pc.ontrack = event => {
    const { track } = event
    const isAudio = track.kind === 'audio'
    const stream = isAudio ? remoteAudioStream : remoteVideoStream
    const el = isAudio ? remoteAudio : remoteVideo

    console.log('[WebRTC] ontrack:', track.kind, track.id, 'muted:', track.muted)

    // Add track to the right stream (idempotent)
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track)
    }

    // Kick playback immediately — may be silent until ICE connects
    tryPlay(el, isAudio ? 'remoteAudio' : 'remoteVideo')

    // Also (re-)play when track goes live after ICE connects
    // Use addEventListener so multiple tracks don't stomp each other's handler
    track.addEventListener('unmute', () => {
      console.log('[WebRTC] track unmuted:', track.kind, track.id)
      tryPlay(el, isAudio ? 'remoteAudio' : 'remoteVideo')
      if (!isAudio) {
        $('remotePlaceholder').classList.add('hidden')
      }
      setCallStatus('Live')
    })

    if (!isAudio) {
      $('remotePlaceholder').classList.add('hidden')
    }
    setCallStatus('Live')
  }

  pc.onconnectionstatechange = () => {
    console.log('[WebRTC] connectionState:', pc.connectionState)
    if (pc.connectionState === 'connected') {
      setCallStatus('Live')
      // Ensure both elements are playing when fully connected
      tryPlay(remoteAudio, 'remoteAudio')
      tryPlay(remoteVideo, 'remoteVideo')
    }

    if (
      pc.connectionState === 'disconnected' ||
      pc.connectionState === 'failed' ||
      pc.connectionState === 'closed'
    ) {
      if (call.inCall) {
        endCall()
      }
    }
  }

  pc.onicegatheringstatechange = () => {
    console.log('[WebRTC] iceGatheringState:', pc.iceGatheringState)
  }

  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] iceConnectionState:', pc.iceConnectionState)
    // Start recording once media is actually flowing
    if (
      (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') &&
      !call.recording
    ) {
      logCallEvent('Call connected (ICE)', { peer: call.peerName })
      startCallRecording()
    }
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      logCallEvent('Connection issue', { state: pc.iceConnectionState })
    }
  }

  return pc
}



function createAvatarVideoTrack(name) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  let step = 0
  const userInitials = initials(name || 'You')
  const displayName = name || 'You'

  function draw() {
    step++
    const bgGrad = ctx.createRadialGradient(320, 240, 40, 320, 240, 380)
    bgGrad.addColorStop(0, '#1e2538')
    bgGrad.addColorStop(1, '#0c1017')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, 640, 480)

    const pulse = Math.sin(step * 0.08) * 5
    const glowRadius = 78 + pulse
    ctx.beginPath()
    ctx.arc(320, 200, glowRadius + 14, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(99, 102, 241, 0.22)'
    ctx.fill()

    const avatarGrad = ctx.createLinearGradient(240, 120, 400, 280)
    avatarGrad.addColorStop(0, '#6366f1')
    avatarGrad.addColorStop(1, '#8b5cf6')
    ctx.beginPath()
    ctx.arc(320, 200, 78, 0, Math.PI * 2)
    ctx.fillStyle = avatarGrad
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(userInitials, 320, 200)

    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = '#f1f5f9'
    ctx.fillText(displayName, 320, 305)

    const pillW = 210
    const pillH = 32
    const pillX = 320 - pillW / 2
    const pillY = 328
    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 16)
    } else {
      ctx.rect(pillX, pillY, pillW, pillH)
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.stroke()

    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText('📷 Camera Not Detected', 320, pillY + 16)
  }

  draw()
  const intervalId = setInterval(draw, 100)
  const stream = canvas.captureStream ? canvas.captureStream(10) : (canvas.mozCaptureStream ? canvas.mozCaptureStream(10) : null)
  if (!stream) return null

  const track = stream.getVideoTracks()[0]
  if (track) {
    const origStop = track.stop.bind(track)
    track.stop = () => {
      clearInterval(intervalId)
      origStop()
    }
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
    osc.connect(dst)
    osc.start()
    const track = dst.stream.getAudioTracks()[0]
    if (track) {
      track.enabled = false
      const origStop = track.stop.bind(track)
      track.stop = () => {
        try { osc.stop() } catch { }
        try { ctx.close() } catch { }
        origStop()
      }
      return track
    }
  } catch (err) {
    console.warn('Could not create silent audio track:', err)
  }
  return null
}


async function getLocalStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('WebRTC media devices are not supported in this browser.')
  }

  // 1. Attempt standard capture: video (ideal user-facing) + audio
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' } },
      audio: true
    })
    call.isAvatarFallback = false
    return stream
  } catch (err) {
    console.warn('Full getUserMedia (video+audio) failed:', err.name, err.message)
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('Microphone or camera permission was denied in your browser settings.')
    }
  }

  // 2. Attempt basic video + audio without constraints
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    })
    call.isAvatarFallback = false
    return stream
  } catch (err) {
    console.warn('Basic getUserMedia (video+audio) failed:', err.name, err.message)
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      throw new Error('Microphone or camera permission was denied in your browser settings.')
    }
  }

  // 3. Fallback: probe audio and video separately
  let audioTrack = null
  let videoTrack = null
  let audioErr = null
  let videoErr = null

  try {
    const aStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioTrack = aStream.getAudioTracks()[0]
  } catch (e) {
    audioErr = e
    console.warn('Microphone capture failed:', e.name, e.message)
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      throw new Error('Microphone permission denied. Please allow microphone access.')
    }
  }

  try {
    const vStream = await navigator.mediaDevices.getUserMedia({ video: true })
    videoTrack = vStream.getVideoTracks()[0]
  } catch (e) {
    videoErr = e
    console.warn('Video capture failed:', e.name, e.message)
  }

  // If neither physical device is available
  if (!audioTrack && !videoTrack) {
    if (
      (audioErr?.name === 'NotAllowedError' || audioErr?.name === 'PermissionDeniedError') ||
      (videoErr?.name === 'NotAllowedError' || videoErr?.name === 'PermissionDeniedError')
    ) {
      throw new Error('Device permission was denied. Please allow access in browser settings.')
    }

    const fallbackVideo = createAvatarVideoTrack(state.session?.username || 'You')
    const fallbackAudio = createSilentAudioTrack()
    if (fallbackVideo && fallbackAudio) {
      call.isAvatarFallback = true
      showToast('⚠️ No camera or mic found. Connecting in preview mode.', 4500)
      return new MediaStream([fallbackAudio, fallbackVideo])
    }
    throw new Error('No camera or microphone found on your computer. Please connect a device.')
  }

  const combined = new MediaStream()

  if (audioTrack) {
    combined.addTrack(audioTrack)
  } else {
    const silent = createSilentAudioTrack()
    if (silent) combined.addTrack(silent)
    showToast('⚠️ No microphone found. Call started with video only.', 4000)
  }

  if (videoTrack) {
    call.isAvatarFallback = false
    combined.addTrack(videoTrack)
  } else {
    call.isAvatarFallback = true
    const avatarTrack = createAvatarVideoTrack(state.session?.username || 'You')
    if (avatarTrack) {
      combined.addTrack(avatarTrack)
    }
    showToast('ℹ️ No camera found. Call started with microphone & avatar.', 4000)
  }

  return combined
}


async function attachLocalMedia(pc) {
  call.localStream = await getLocalStream()
  $('localVideo').srcObject = call.localStream
  $('localVideo').classList.toggle('unmirrored', Boolean(call.isAvatarFallback))
  call.localStream.getTracks().forEach(track => {
    pc.addTrack(track, call.localStream)
  })
}


async function handleCallSignal(data) {
  if (!CALL_TYPES.has(data.type)) {
    return false
  }

  if (data.type === 'call_offer') {
    if (call.inCall) {
      sendCallSignal({
        type: 'call_reject',
        target_id: data.sender_id
      })
      return true
    }

    if (call.incomingOffer) {
      return true
    }

    call.incomingOffer = data.sdp
    call.peerId = data.sender_id
    call.peerName = callerName(data.sender_id)

    $('incomingCallName').textContent = call.peerName
    $('incomingCallAvatar').textContent = initials(call.peerName)
    $('incomingCallModal').classList.remove('hidden')
    return true
  }

  if (data.type === 'call_answer') {
    if (
      call.pc &&
      data.sdp &&
      call.pc.signalingState === 'have-local-offer'
    ) {
      await call.pc.setRemoteDescription({
        type: 'answer',
        sdp: data.sdp
      })
      await flushIce()
      setCallStatus('Connecting…')
    }
    return true
  }

  if (data.type === 'call_ice') {
    if (!data.candidate) {
      return true
    }

    if (call.pc && call.pc.remoteDescription) {
      try {
        await call.pc.addIceCandidate(data.candidate)
      } catch { }
    } else {
      call.pendingIce.push(data.candidate)
    }
    return true
  }

  if (data.type === 'call_reject' || data.type === 'call_end') {
    const wasIncoming = Boolean(call.incomingOffer)
    endCall()
    if (data.type === 'call_reject' && wasIncoming === false) {
      showToast('Call declined', 3000)
    }
    return true
  }

  return true
}


async function startOutgoingCall() {
  if (!state.selected || call.inCall) {
    return
  }

  try {
    call.peerId = state.selected.id
    call.peerName = state.selected.username
    call.pendingIce = []

    const pc = createPeerConnection()
    await attachLocalMedia(pc)

    // Don't use deprecated offerToReceive* flags — tracks added via
    // addTrack already negotiate sendrecv direction automatically
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    console.log('[WebRTC] Sending offer, local tracks:',
      pc.getSenders().map(s => s.track?.kind))

    sendCallSignal({
      type: 'call_offer',
      sdp: pc.localDescription.sdp,
      target_id: call.peerId
    })

    call.inCall = true
    showCallStage(call.peerName, `Calling ${call.peerName}…`)
  } catch (error) {
    endCall()
    showToast(`❌ ${error.message}`, 4000)
  }
}


document.querySelectorAll('[data-video-call]').forEach(button => {
  button.addEventListener('click', startOutgoingCall)
})


$('acceptCallBtn').addEventListener('click', async () => {
  try {
    $('incomingCallModal').classList.add('hidden')

    const pc = createPeerConnection()

    await pc.setRemoteDescription({
      type: 'offer',
      sdp: call.incomingOffer
    })
    await flushIce()

    // Now add local media after remote description is set
    await attachLocalMedia(pc)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    console.log('[WebRTC] Sending answer, local tracks:',
      pc.getSenders().map(s => s.track?.kind))

    sendCallSignal({
      type: 'call_answer',
      sdp: pc.localDescription.sdp,
      target_id: call.peerId
    })

    call.inCall = true
    call.incomingOffer = null
    showCallStage(call.peerName, 'Connecting…')
  } catch (error) {
    endCall()
    showToast(`❌ ${error.message}`, 4000)
  }
})


$('rejectCallBtn').addEventListener('click', () => {
  sendCallSignal({
    type: 'call_reject',
    target_id: call.peerId
  })
  call.incomingOffer = null
  $('incomingCallModal').classList.add('hidden')
})


$('muteBtn').addEventListener('click', () => {
  const track = call.localStream?.getAudioTracks()[0]
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  $('muteBtn').classList.toggle('active', !track.enabled)
  setControlLabel($('muteBtn'), track.enabled ? 'Mute' : 'Unmute')
  logCallEvent(track.enabled ? 'Microphone unmuted' : 'Microphone muted')
})


$('cameraBtn').addEventListener('click', () => {
  const track = call.localStream?.getVideoTracks()[0]
  if (!track) {
    return
  }

  track.enabled = !track.enabled
  $('cameraBtn').classList.toggle('active', !track.enabled)
  setControlLabel($('cameraBtn'), track.enabled ? 'Camera' : 'Camera On')
  logCallEvent(track.enabled ? 'Camera enabled' : 'Camera disabled')
})


$('endCallBtn').addEventListener('click', () => {
  sendCallSignal({
    type: 'call_end',
    target_id: call.peerId
  })
  endCall()
})


// ── Call Recording & Transcription ─────────────────────────────────

function bestMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4'
  ]
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || ''
}

function startCallRecording() {
  if (call.recording) return

  const mime = bestMimeType()
  call.localChunks = []
  call.remoteChunks = []
  call.callStartTime = new Date().toISOString()
  call.recording = true

  logCallEvent('Recording started')
  logCallEvent('Participant joined', { participant: state.session?.username })
  logCallEvent('Participant joined', { participant: call.peerName })

  // Record local microphone
  if (call.localStream) {
    const localAudio = new MediaStream(call.localStream.getAudioTracks())
    if (localAudio.getTracks().length) {
      try {
        call.localRecorder = new MediaRecorder(localAudio, mime ? { mimeType: mime } : {})
        call.localRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) call.localChunks.push(e.data)
        }
        call.localRecorder.start(1000)
        console.log('[Recording] Local audio recorder started')
      } catch (e) {
        console.warn('[Recording] Local recorder failed:', e)
      }
    }
  }

  // Record remote audio from the <audio> element's srcObject
  const remoteAudioEl = $('remoteAudio')
  if (remoteAudioEl && remoteAudioEl.srcObject) {
    const remoteStream = new MediaStream(
      remoteAudioEl.srcObject.getAudioTracks()
    )
    if (remoteStream.getTracks().length) {
      try {
        call.remoteRecorder = new MediaRecorder(remoteStream, mime ? { mimeType: mime } : {})
        call.remoteRecorder.ondataavailable = e => {
          if (e.data && e.data.size > 0) call.remoteChunks.push(e.data)
        }
        call.remoteRecorder.start(1000)
        console.log('[Recording] Remote audio recorder started')
      } catch (e) {
        console.warn('[Recording] Remote recorder failed:', e)
      }
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

/** Log a timestamped call event to be sent to n8n. */
function logCallEvent(eventName, detail = {}) {
  call.events.push({
    time: new Date().toISOString(),
    event: eventName,
    participant: state.session?.username || 'Me',
    ...detail
  })
  console.log('[Event]', eventName, detail)
}

async function submitCallSummary(peerName, startTime, localBlob, remoteBlob, events) {
  if (!state.session) return

  showToast('📝 Transcribing call…', 6000)

  const fd = new FormData()
  const mimeType = localBlob?.type || remoteBlob?.type || 'audio/webm'
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'

  if (localBlob && localBlob.size > 0) {
    fd.append('local_audio', localBlob, `local.${ext}`)
  }
  if (remoteBlob && remoteBlob.size > 0) {
    fd.append('remote_audio', remoteBlob, `remote.${ext}`)
  }
  fd.append('peer_name', peerName || 'Unknown')
  fd.append('my_name', state.session?.username || 'Me')
  fd.append('call_start', startTime || new Date().toISOString())
  fd.append('call_end', new Date().toISOString())
  // Send the event log as JSON string for n8n's important_events field
  fd.append('call_events', JSON.stringify(events || []))

  try {
    const res = await fetch('/api/call-summary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.session.access_token}` },
      body: fd
    })
    if (res.ok) {
      showToast('✅ Call summary sent to n8n!', 4000)
    } else {
      const err = await res.json().catch(() => ({}))
      showToast(`⚠️ Summary failed: ${err.detail || res.status}`, 5000)
    }
  } catch (e) {
    console.error('[Summary] Failed:', e)
    showToast('⚠️ Could not send call summary.', 4000)
  }
}


function endCall() {
  const pc = call.pc
  call.pc = null
  call.inCall = false

  if (pc) {
    pc.close()
  }

  // Snapshot recording state before resetting
  const wasRecording = call.recording
  const localRecorder = call.localRecorder
  const remoteRecorder = call.remoteRecorder
  const localChunks = call.localChunks
  const remoteChunks = call.remoteChunks
  const callStartTime = call.callStartTime
  const peerName = call.peerName
  const callEvents = [...call.events]  // snapshot before reset

  if (call.localStream) {
    call.localStream.getTracks().forEach(track => track.stop())
    call.localStream = null
  }

  $('remoteAudio').srcObject = null
  $('remoteVideo').srcObject = null
  $('localVideo').srcObject = null
  $('localVideo').classList.remove('unmirrored')
  $('remotePlaceholder').classList.remove('hidden')
  setCallButtonsBusy(false)
  $('muteBtn').classList.remove('active')
  $('cameraBtn').classList.remove('active')
  setControlLabel($('muteBtn'), 'Mute')
  setControlLabel($('cameraBtn'), 'Camera')

  call.inCall = false
  call.incomingOffer = null
  call.peerId = null
  call.peerName = ''
  call.pendingIce = []
  call.isAvatarFallback = false
  call.localRecorder = null
  call.remoteRecorder = null
  call.localChunks = []
  call.remoteChunks = []
  call.callStartTime = null
  call.recording = false
  call.events = []

  $('videoModal').classList.add('hidden')
  $('incomingCallModal').classList.add('hidden')

  // Transcribe & summarise asynchronously after call ends
  if (wasRecording) {
    logCallEvent && callEvents.push({
      time: new Date().toISOString(),
      event: 'Call ended',
      participant: state.session?.username || 'Me'
    })
    Promise.all([
      stopRecorderAsync(localRecorder),
      stopRecorderAsync(remoteRecorder)
    ]).then(() => {
      const localBlob = localChunks.length
        ? new Blob(localChunks, { type: localChunks[0]?.type || 'audio/webm' })
        : null
      const remoteBlob = remoteChunks.length
        ? new Blob(remoteChunks, { type: remoteChunks[0]?.type || 'audio/webm' })
        : null

      if (localBlob || remoteBlob) {
        submitCallSummary(peerName, callStartTime, localBlob, remoteBlob, callEvents)
      } else {
        console.log('[Recording] No audio captured, skipping summary.')
      }
    })
  }
}