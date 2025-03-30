require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { OpenAI } = require("openai");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ],
});


const openai = new OpenAI({
    apiKey: process.env.sk-proj-YI8BSlrGk_J-Ewt0ZFcM5Jg6RwvFFNqTnbGJbFMdX1IqWiEkNn88UWNWP867dm60HG3ylEAdivT3BlbkFJmxnyDVs9PzXuNFaBiELme0u8pAWS7z6SXdlqr4HeMFT1t81i9ktB2nqpVpASIfsp2la_DxeqQAs
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// Command to create a ticket channel
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'ticket') {
        const guild = interaction.guild;
        const ticketChannel = await guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: 0, // 0 means text channel
            parent: null, // Set a category ID here if you have one
            permissionOverwrites: [
                {
                    id: guild.id, // Everyone
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.user.id, // The user who created the ticket
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: client.user.id, // The bot
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
            ],
        });

        await interaction.reply({ content: `✅ Ticket created! Go to ${ticketChannel}`, ephemeral: true });

        ticketChannel.send(`🎫 **Ticket Opened!**  
        👋 Hello <@${interaction.user.id}>, how can we help you?  
        🔒 Type \`!close\` to close this ticket.`);
    }
});

// AI Response in Tickets
client.on('messageCreate', async message => {
    if (message.author.bot || !message.channel.name.startsWith('ticket-')) return;

    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message.content }],
    });

    message.reply(response.choices[0].message.content);
});

// Close Ticket Command
client.on('messageCreate', async message => {
    if (message.content === '!close' && message.channel.name.startsWith('ticket-')) {
        await message.channel.send('🛑 Closing ticket in 5 seconds...');
        setTimeout(() => message.channel.delete(), 5000);
    }
});

// Log in the bot
client.login(process.env.TOKEN);
