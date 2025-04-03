const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Configuration, OpenAIApi } = require('openai');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
const ticketCache = new Map(); // Cache for tickets
const closedTickets = new Map(); // Store closed tickets for reopening
const AUTO_CLOSE_TIME = 24 * 60 * 60 * 1000; // 24 hours in ms
const REOPEN_WINDOW = 6 * 60 * 60 * 1000; // 6-hour reopen window

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.first();
    if (!guild) return;

    // Cache important roles & channels
    guild.channels.cache.forEach(channel => ticketCache.set(channel.name, channel));
    const supportRoleIds = ['ADMIN_ROLE_ID', 'MODERATOR_ROLE_ID'];

    // Ensure Tickets category exists
    let ticketsCategory = guild.channels.cache.find(c => c.name === "Tickets" && c.type === ChannelType.GuildCategory);
    if (!ticketsCategory) {
        ticketsCategory = await guild.channels.create({ name: "Tickets", type: ChannelType.GuildCategory });
    }

    // Ensure Ticket Panel exists
    let ticketPanelChannel = ticketCache.get("ticket-panel");
    if (!ticketPanelChannel) {
        ticketPanelChannel = await guild.channels.create({
            name: "ticket-panel",
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, allow: [PermissionFlagsBits.ViewChannel] }
            ]
        });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('🎫 Open a Ticket').setStyle(ButtonStyle.Primary)
        );
        await ticketPanelChannel.send({ content: 'Click the button below to open a support ticket.', components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { guild, user } = interaction;
    const supportRoleIds = ['ADMIN_ROLE_ID', 'MODERATOR_ROLE_ID'];
    const ticketsCategory = guild.channels.cache.find(c => c.name === "Tickets" && c.type === ChannelType.GuildCategory);
    const logChannel = guild.channels.cache.find(c => c.name === "ticket-logs" && c.type === ChannelType.GuildText);

    if (interaction.customId === 'create_ticket') {
        // Check if user has a recently closed ticket
        if (closedTickets.has(user.id) && Date.now() - closedTickets.get(user.id).timestamp < REOPEN_WINDOW) {
            const oldChannel = closedTickets.get(user.id).channel;
            await interaction.reply({ content: `✅ Reopening your previous ticket: ${oldChannel}`, ephemeral: true });
            closedTickets.delete(user.id);
            return;
        }
        
        // Create ticket channel
        const ticketChannel = await guild.channels.create({
            name: `ticket-${user.username}`,
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

        await ticketChannel.send({
            content: `Hello ${user}, a support agent will assist you shortly. If you're a support agent, click "Claim Ticket" to take ownership.`,
            components: [buttons]
        });
        
        // AI Welcome Message
        try {
            const response = await openai.createChatCompletion({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: "You are a crypto support assistant. Welcome users and offer initial guidance on crypto-related support." },
                    { role: 'user', content: "A new ticket has been opened." }
                ]
            });
            await ticketChannel.send(response.data.choices[0].message.content);
        } catch (error) {
            console.error("OpenAI API Error:", error);
        }

        // Auto-close inactive ticket after 24 hours
        setTimeout(async () => {
            if (ticketChannel && ticketChannel.messages.cache.size === 0) {
                await ticketChannel.delete();
                closedTickets.set(user.id, { channel: ticketChannel, timestamp: Date.now() });
                logChannel?.send(`⏳ Ticket auto-closed due to inactivity: ${ticketChannel.name}`);
            }
        }, AUTO_CLOSE_TIME);

        logChannel?.send(`📌 Ticket created: ${ticketChannel}`);
        await interaction.reply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });
    } else if (interaction.customId === 'claim_ticket') {
        if (!interaction.member.roles.cache.some(role => supportRoleIds.includes(role.id))) {
            return interaction.reply({ content: "❌ You are not authorized to claim tickets.", ephemeral: true });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });
        await interaction.reply({ content: `✅ Ticket claimed by ${interaction.user}`, ephemeral: false });
        logChannel?.send(`🎟️ Ticket claimed by ${interaction.user.tag}: ${interaction.channel.name}`);
    } else if (interaction.customId === 'close_ticket') {
        closedTickets.set(user.id, { channel: interaction.channel, timestamp: Date.now() });
        await interaction.channel.delete();
        logChannel?.send(`🛑 Ticket closed by ${interaction.user.username}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
