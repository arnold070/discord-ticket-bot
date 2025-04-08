const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const OpenAI = require("openai");
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const ticketCache = new Map();
const closedTickets = new Map();
const AUTO_CLOSE_TIME = 24 * 60 * 60 * 1000;
const REOPEN_WINDOW = 6 * 60 * 60 * 1000;
const supportRoleIds = ['1355476759344054364', '1355477311540957244'];

let ticketCounter = 0; // Initialize ticket number counter

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.first();
    if (!guild) return;

    let ticketsCategory = guild.channels.cache.find(c => c.name === "Tickets" && c.type === ChannelType.GuildCategory);
    if (!ticketsCategory) {
        ticketsCategory = await guild.channels.create({ name: "Tickets", type: ChannelType.GuildCategory });
    }

    let logChannel = guild.channels.cache.find(c => c.name === "ticket-logs" && c.type === ChannelType.GuildText);
    if (!logChannel) {
        logChannel = await guild.channels.create({
            name: "ticket-logs",
            type: ChannelType.GuildText
        });
    }

    let ticketPanelChannel = guild.channels.cache.find(c => c.name === "ticket-panel" && c.type === ChannelType.GuildText);
    if (!ticketPanelChannel) {
        ticketPanelChannel = await guild.channels.create({
            name: "ticket-panel",
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel] }]
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Create a Ticket').setStyle(ButtonStyle.Primary)
        );

        await ticketPanelChannel.send({ content: 'Click below to open a support ticket.', components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    await interaction.deferReply({ ephemeral: true });  // ✅ Fix interaction failure

    const { guild, user } = interaction;
    const ticketsCategory = guild.channels.cache.find(c => c.name === "Tickets" && c.type === ChannelType.GuildCategory);
    const logChannel = guild.channels.cache.find(c => c.name === "ticket-logs" && c.type === ChannelType.GuildText);

    if (interaction.customId === 'create_ticket') {
        ticketCounter++; // Increment the ticket number each time a new ticket is created

        const ticketChannelName = `ticket-${ticketCounter}-${user.username}`; // Add the ticket number as prefix
        const ticketChannel = await guild.channels.create({
            name: ticketChannelName,  // Use the ticket number as prefix
            type: ChannelType.GuildText,
            parent: ticketsCategory?.id,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                ...supportRoleIds.map(id => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }))
            ]
        });

        ticketCache.set(user.id, ticketChannel);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('claim_ticket').setLabel('✅ Claim Ticket').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('close_ticket').setLabel('❌ Close Ticket').setStyle(ButtonStyle.Danger)
        );

        // Get the support role mention
        const supportRoleMention = supportRoleIds.map(id => `<@&${id}>`).join(', ');

        // Send initial message with prefix and suffix, including the support role mention
        await ticketChannel.send({
            content: `**Ticket ID:** #${ticketCounter} - Hello ${user}, a support agent will assist you shortly. ${supportRoleMention}, please claim this ticket.`,
            components: [buttons]
        });

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: "You are a crypto support assistant. Welcome users and offer initial guidance on crypto-related support." },
                    { role: 'user', content: "A new ticket has been opened." }
                ]
            });
            await ticketChannel.send(response.choices[0].message.content);
        } catch (error) {
            console.error("OpenAI API Error:", error);
        }

        setTimeout(async () => {
            if (ticketChannel && ticketChannel.messages.cache.size === 0) {
                await ticketChannel.delete();
                closedTickets.set(user.id, { channel: ticketChannel, timestamp: Date.now() });
                logChannel?.send(`⏳ Ticket auto-closed: ${ticketChannel.name}`);
            }
        }, AUTO_CLOSE_TIME);

        logChannel?.send(`📌 Ticket created: ${ticketChannel}`);
        await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
    } else if (interaction.customId === 'claim_ticket') {
        if (!interaction.member.roles.cache.some(role => supportRoleIds.includes(role.id))) {
            return interaction.editReply({ content: "❌ You are not authorized to claim tickets." });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });
        await interaction.editReply({ content: `✅ Ticket claimed by ${interaction.user}` });
        logChannel?.send(`🎟️ Ticket claimed by ${interaction.user.tag}: ${interaction.channel.name}`);
    } else if (interaction.customId === 'close_ticket') {
        closedTickets.set(user.id, { channel: interaction.channel, timestamp: Date.now() });
        await interaction.channel.delete();
        logChannel?.send(`🛑 Ticket closed by ${interaction.user.username}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
