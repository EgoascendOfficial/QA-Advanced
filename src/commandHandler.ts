import {
    Client,
    Constants,
    Message,
    CommandInteraction,
    ApplicationCommandOptions,
    AutocompleteInteraction,
    ComponentInteraction,
    ModalSubmitInteraction,
    ApplicationCommandBulkEditOptions,
    ApplicationCommandTypes,
    ApplicationCommandOptionTypes,
    ApplicationCommandOptionsWithValue,
    Interaction
} from 'eris';
import { Command } from './types/command';
import * as fs from 'fs';
import * as path from 'path';
import config from './secret/config.json';

interface Subcommand {
    parent?: string;
    subcommand: string;
    description: string;
    options: ApplicationCommandOptions[];
    execute: (interaction: CommandInteraction, bot: Client) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction, bot: Client) => Promise<void>;
}

export class CommandHandler {
    private bot: Client;
    private prefix: string = config.prefix;
    private commands: Map<string, Map<string, Command>> = new Map();
    private subcommands: Map<string, Subcommand[]> = new Map();

    constructor(bot: Client) {
        this.bot = bot;
        this.loadCommands();
    }

    registerEvents(): void {
        console.log('Registering events for command handler');
        this.commands.forEach((commandMap, eventName) => {
            switch (eventName) {
                case 'onMessage':
                    this.bot.on('messageCreate', async (msg: Message) => {
                        if (msg.author.id === this.bot.user.id) return;
                        if (!msg.content.startsWith(this.prefix)) return;

                        const content = msg.content.slice(this.prefix.length).trim();
                        const words = content.split(/\s+/);
                        const commandName = words[0].toLowerCase();
                        const args = words.slice(1);

                        const command = commandMap.get(commandName);
                        if (command) {
                            try {
                                await command.execute(msg, args);
                            } catch (error) {
                                console.error(`Error executing onMessage command ${commandName}:`, error);
                            }
                        }
                    });
                    break;

                case 'interactionCreate':
                    this.bot.on('interactionCreate', async (interaction: Interaction) => {
                        if (interaction.type === Constants.InteractionTypes.APPLICATION_COMMAND) {
                            const commandInteraction = interaction as CommandInteraction;
                            const command = commandMap.get(commandInteraction.data.name);
                            if (command) {
                                const subcommandName = commandInteraction.data.options?.[0]?.name;
                                const subcommands = this.subcommands.get(commandInteraction.data.name) || [];

                                if (subcommandName) {
                                    const subcommand = subcommands.find(sc => sc.subcommand === subcommandName);
                                    if (subcommand) {
                                        try {
                                            await subcommand.execute(commandInteraction, this.bot);
                                        } catch (error) {
                                            console.error(`Error executing subcommand ${command.name}/${subcommandName}:`, error);
                                            await commandInteraction.createMessage({
                                                embeds: [{
                                                    color: 0xFF0000,
                                                    description: '❌ An error occurred while processing the command.'
                                                }]
                                            });
                                        }
                                        return;
                                    }
                                }

                                try {
                                    await command.execute(commandInteraction);
                                } catch (error) {
                                    console.error(`Error executing slash command ${command.name}:`, error);
                                    await commandInteraction.createMessage({
                                        embeds: [{
                                            color: 0xFF0000,
                                            description: '❌ An error occurred while processing the command.'
                                        }]
                                    });
                                }
                            }
                        }
                        else if (interaction.type === Constants.InteractionTypes.APPLICATION_COMMAND_AUTOCOMPLETE) {
                            const autocompleteInteraction = interaction as AutocompleteInteraction;
                            const command = commandMap.get(autocompleteInteraction.data.name);
                            const subcommands = this.subcommands.get(autocompleteInteraction.data.name) || [];

                            const subcommandName = autocompleteInteraction.data.options?.[0]?.name;
                            if (subcommandName) {
                                const subcommand = subcommands.find(sc => sc.subcommand === subcommandName);
                                if (subcommand?.autocomplete) {
                                    try {
                                        await subcommand.autocomplete(autocompleteInteraction, this.bot);
                                    } catch (error) {
                                        console.error(`Error handling autocomplete for ${command?.name}/${subcommandName}:`, error);
                                    }
                                    return;
                                }
                            }

                            if (command?.autocomplete) {
                                try {
                                    await command.autocomplete(autocompleteInteraction);
                                } catch (error) {
                                    console.error(`Error handling autocomplete for ${command.name}:`, error);
                                }
                            }
                        }
                        else if (interaction.type === Constants.InteractionTypes.MESSAGE_COMPONENT) {
                            const componentInteraction = interaction as ComponentInteraction;
                            const command = commandMap.get(componentInteraction.data.custom_id);
                            if (command) {
                                try {
                                    await command.execute(componentInteraction);
                                } catch (error) {
                                    console.error(`Error executing component command ${command.name}:`, error);
                                }
                            }
                        }
                        else if (interaction.type === Constants.InteractionTypes.MODAL_SUBMIT) {
                            const modalInteraction = interaction as ModalSubmitInteraction;
                            commandMap.forEach(async (command) => {
                                if (!command.name || command.name === modalInteraction.data.custom_id) {
                                    try {
                                        await command.execute(modalInteraction);
                                    } catch (error) {
                                        console.error(`Error executing modal command ${command.name}:`, error);
                                    }
                                }
                            });
                        }
                    });
                    break;

                case 'messageCreate':
                    this.bot.on('messageCreate', async (msg: Message) => {
                        commandMap.forEach(async (command) => {
                            try {
                                await command.execute(msg);
                            } catch (error) {
                                console.error(`Error executing messageCreate command ${command.name}:`, error);
                            }
                        });
                    });
                    break;

                default:
                    this.bot.on(eventName as any, async (...args: any[]) => {
                        commandMap.forEach(async (command) => {
                            try {
                                await command.execute(...args);
                            } catch (error) {
                                console.error(`Error executing ${eventName} command ${command.name}:`, error);
                            }
                        });
                    });
                    break;
            }
        });
    }

    async registerSlashCommands(): Promise<void> {
        const interactionCommands = this.commands.get('interactionCreate') || new Map();

        this.subcommands.forEach((subs, parentName) => {
            if (!interactionCommands.has(parentName)) {
                const implicitCommand: Command = {
                    name: parentName,
                    description: `Manage ${parentName}`,
                    type: 'interactionCreate',
                    interactionType: ApplicationCommandTypes.CHAT_INPUT,
                    options: [],
                    execute: async (interaction: CommandInteraction) => {
                        await interaction.createFollowup({
                            embeds: [{ color: 0xFF0000, description: '❌ Please use a subcommand.' }]
                        });
                    }
                };
                interactionCommands.set(parentName, implicitCommand);
            }
        });

        const commands: ApplicationCommandBulkEditOptions[] = Array.from(interactionCommands.values())
            .filter(cmd => cmd.interactionType !== undefined && cmd.name !== undefined)
            .map(cmd => {
                const subcommands = this.subcommands.get(cmd.name!) || [];
                return {
                    name: cmd.name!,
                    type: cmd.interactionType!,
                    description: cmd.interactionType === ApplicationCommandTypes.CHAT_INPUT
                        ? (cmd.description || 'No description')
                        : undefined,
                    options: [
                        ...(cmd.options || []),
                        ...subcommands.map(sc => ({
                            name: sc.subcommand,
                            description: sc.description || `${sc.subcommand} command`,
                            type: ApplicationCommandOptionTypes.SUB_COMMAND,
                            options: sc.options as ApplicationCommandOptionsWithValue[]
                        }))
                    ]
                };
            });

        if (commands.length === 0) {
            console.log('No slash commands to register');
            return;
        }

        try {
            await this.bot.bulkEditCommands(commands);
            console.log('Successfully registered global slash commands:', commands.map(c => c.name));
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    private loadCommands(): void {
        const commandsPath = path.join(__dirname, 'commands');
        this.loadCommandsRecursive(commandsPath);
    }

    private loadCommandsRecursive(dir: string): void {
        const files = fs.readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                this.loadCommandsRecursive(fullPath);
            } else if (file.isFile() && file.name.endsWith('.js')) {
                try {
                    const commandModule = require(fullPath);
                    let commandOrSubcommand: Command | Subcommand;

                    if (typeof commandModule === 'function') {
                        commandOrSubcommand = commandModule(this.bot);
                    } else if (commandModule.default) {
                        commandOrSubcommand = typeof commandModule.default === 'function'
                            ? commandModule.default(this.bot)
                            : commandModule.default;
                    } else {
                        commandOrSubcommand = commandModule;
                    }

                    if ('subcommand' in commandOrSubcommand) {
                        const subcommand = commandOrSubcommand as Subcommand;
                        if (!subcommand.parent) continue;
                        if (!this.subcommands.has(subcommand.parent)) {
                            this.subcommands.set(subcommand.parent, []);
                        }
                        this.subcommands.get(subcommand.parent)!.push(subcommand);
                    } else {
                        const command = commandOrSubcommand as Command;
                        if (!command.type) continue;
                        if (command.type !== 'interactionCreate' && !command.name) continue;
                        if (!this.commands.has(command.type)) {
                            this.commands.set(command.type, new Map());
                        }
                        this.commands.get(command.type)!.set(command.name || '', command);
                    }
                } catch (error) {
                    console.error(`Error loading command from ${fullPath}:`, error);
                }
            }
        }
    }
                    }
