const state = {
  session: JSON.parse(localStorage.getItem('relay_session') || 'null'),
  socket: null,
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


/* ============================================================
   AUTHENTICATION
============================================================ */

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

    if (state.socket) {
      state.socket.close()
    }

    resetVoiceState()

    localStorage.removeItem(
      'relay_session'
    )

    state.session = null

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
      `user-row ${
        state.selected?.id === user.id
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
    loadUsers().catch(() => {})
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


  state.socket.onmessage =
    event => {

      const data =
        JSON.parse(event.data)

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
  } catch {}

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
    } catch {}
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

  } catch {}


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

    } catch {}
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