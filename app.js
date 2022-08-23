const { 
  Client, 
  List, 
  Buttons, 
  MessageMedia, 
  LocalAuth 
} = require('whatsapp-web.js');
const express = require('express');
const { 
  body, 
  validationResult 
} = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
//const mime = require('mime-types');

const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(fileUpload({
  debug: true
}));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'zap-press' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--log-level=3',
      '--no-default-browser-check',
      '--disable-site-isolation-trials',
      '--no-experiments',
      '--ignore-gpu-blacklist',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--enable-features=NetworkService',
      '--disable-setuid-sandbox',
      '--no-sandbox',
      '--disable-webgl',
      '--disable-threaded-animation',
      '--disable-threaded-scrolling',
      '--disable-in-process-stack-traces',
      '--disable-histogram-customizer',
      '--disable-gl-extensions',
      '--disable-composited-antialiasing',
      '--disable-canvas-aa',
      '--disable-3d-apis',
      '--disable-accelerated-2d-canvas',
      '--disable-accelerated-jpeg-decoding',
      '--disable-accelerated-mjpeg-decode',
      '--disable-app-list-dismiss-on-blur',
      '--disable-accelerated-video-decode'
    ],
  }
});

client.on('message', async msg => {
  //Setar as mensagens de BOT AQUI
  //Ao enviar !ping o bot responde pong
  if (msg.body.toLowerCase() === '!ping') {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    setTimeout(function () {
      msg.reply('pong');
    }, 5000);
    //!groupinfo responde com as informações do grupo que o bot esta
  } else if (msg.body.toLowerCase() === '!groupinfo') {
    let chat = await msg.getChat();
    await chat.sendStateTyping();
    setTimeout(function () {
      if (chat.isGroup) {
        msg.reply(`*Detalhes do Grupo*\n\rNome: _${chat.name}_\n\rDescrição: _${chat.description}_\n\rCriado em: _${chat.createdAt.toString()}_\n\rCriado por: _${chat.owner.user}_\n\rParticipantes: _${chat.participants.length}_`);
      } else {
        msg.reply('Este comando só pode ser usado em Grupo!');
      }
    }, 5000);
    //Comando para enviar mensagem sem precisar salvar contato, ex: !sendto 5522999999999 Mensagem de Teste  
  } else if (msg.body.startsWith('!sendto ')) {
    let number = msg.body.split(' ')[1];
    let messageIndex = msg.body.indexOf(number) + number.length;
    let message = msg.body.slice(messageIndex, msg.body.length);
    number = number.includes('@c.us') ? number : `${number}@c.us`;
    let chat = await msg.getChat();
    chat.sendSeen();
    client.sendMessage(number, message);
    //Atualiza o Status do bot, ex: !status Meu Status de Teste  
  } else if (msg.body.startsWith('!status ')) {
    const newStatus = msg.body.split(' ')[1];
    await client.setStatus(newStatus);
    msg.reply(`O status do bot foi atualizado para:\n*${newStatus}*`);
    //Esta função retorna uma mensagem automaticamente quando recebe audio 
  } else if (msg.type === 'ptt') {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    setTimeout(function () {
      msg.reply("Desculpe, muito barulho aqui");
    }, 4000);
    setTimeout(function () {
      client.sendMessage(msg.from, "Consegue digitar?");
    }, 8000);
    //Esta função retorna uma mensagem mencionando a pessoa 
  } else if (msg.body.toLowerCase() === 'oi') {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    const contact = await msg.getContact();
    await chat.sendMessage(`Olá @${contact.id.user}!`, {
      mentions: [contact]
    });
    //Menciona todos os usuários que estão no grupo
  } else if (msg.body.toLowerCase() === '!everyone') {
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    if (chat.isGroup) {
      let text = "";
      let mentions = [];
      for (let participant of chat.participants) {
        const contact = await client.getContactById(participant.id._serialized);
        mentions.push(contact);
        text += `@${participant.id.user} `;
      }
      await chat.sendMessage(text, { mentions });
    } else {
      msg.reply('Este comando só pode ser usado em Grupo!');
    }
  }
});

client.initialize();

// Socket IO
io.on('connection', function (socket) {
  socket.emit('message', 'Conectando...');

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit('qr', url);
      socket.emit('message', 'QR Code recebido, escaneie por favor!');
    });
  });

  client.on('ready', () => {
    socket.emit('ready', 'Whatsapp está pronto!');
    socket.emit('message', 'Whatsapp está pronto!');
  });

  client.on('authenticated', () => {
    socket.emit('authenticated', 'Whatsapp autenticado!');
    socket.emit('message', 'Whatsapp é autenticado!');
    console.log('AUTENTICADO');
  });

  client.on('auth_failure', function (session) {
    socket.emit('message', 'Falha de autenticação, reiniciando...');
  });

  client.on('disconnected', (reason) => {
    socket.emit('message', 'Whatsapp está desconectado!');
    fs.unlinkSync(SESSION_FILE_PATH, function (err) {
      if (err) return console.log(err);
      console.log('Arquivo de sessão excluído!');
    });
    client.destroy();
    client.initialize();
  });
});

const checkRegisteredNumber = async function (number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
}

// Send message
app.post('/send-message', [
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
    });
  }

  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Send media
app.post('/send-media', async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, 'Media');

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

const findGroupByName = async function (name) {
  const group = await client.getChats().then(chats => {
    return chats.find(chat =>
      chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
}

// Send message to group
// You can use chatID or group name, yea!
app.post('/send-group-message', [
  body('id').custom((value, { req }) => {
    if (!value && !req.body.name) {
      throw new Error('Valor inválido, você pode usar `id` ou `name`');
    }
    return true;
  }),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  let chatId = req.body.id;
  const groupName = req.body.name;
  const message = req.body.message;

  // Find the group by name
  if (!chatId) {
    const group = await findGroupByName(groupName);
    if (!group) {
      return res.status(422).json({
        status: false,
        message: 'Nenhum grupo encontrado com o nome de: ' + groupName
      });
    }
    chatId = group.id._serialized;
  }

  client.sendMessage(chatId, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Clearing message on spesific chat
app.post('/clear-message', [
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
    });
  }

  const chat = await client.getChatById(number);

  chat.clearMessages().then(status => {
    res.status(200).json({
      status: true,
      response: status
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  })
});

// Send button
app.post('/send-button', [
  body('number').notEmpty(),
  body('buttonBody').notEmpty(),
  body('bt1').notEmpty(),
  body('bt2').notEmpty(),
  body('bt3').notEmpty(),
  body('buttonTitle').notEmpty(),
  body('buttonFooter').notEmpty()

], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const buttonBody = req.body.buttonBody;
  const bt1 = req.body.bt1;
  const bt2 = req.body.bt2;
  const bt3 = req.body.bt3;
  const buttonTitle = req.body.buttonTitle;
  const buttonFooter = req.body.buttonFooter;
  const button = new Buttons(buttonBody, [{ body: bt1 }, { body: bt2 }, { body: bt3 }], buttonTitle, buttonFooter);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
    });
  }

  client.sendMessage(number, button).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Send List
app.post('/send-list', [
  body('number').notEmpty(),
  body('ListItem1').notEmpty(),
  body('desc1').notEmpty(),
  body('ListItem2').notEmpty(),
  body('desc2').notEmpty(),
  body('List_body').notEmpty(),
  body('btnText').notEmpty(),
  body('Title').notEmpty(),
  body('footer').notEmpty()
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const sectionTitle = req.body.sectionTitle;
  const ListItem1 = req.body.ListItem1;
  const desc1 = req.body.desc1;
  const ListItem2 = req.body.ListItem2;
  const desc2 = req.body.desc2;
  const List_body = req.body.List_body;
  const btnText = req.body.btnText;
  const Title = req.body.Title;
  const footer = req.body.footer;

  const sections = [{ title: sectionTitle, rows: [{ title: ListItem1, description: desc1 }, { title: ListItem2, description: desc2 }] }];
  const list = new List(List_body, btnText, sections, Title, footer);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
    });
  }

  client.sendMessage(number, list).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

server.listen(port, function () {
  console.log('Aplicativo em execução na porta: ' + port);
});