// src/userplugins/SmartCleanup/index.tsx
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    sendBotMessage,
} from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    searchDelay: { type: OptionType.NUMBER, default: 800, description: "Delay between searches (ms)" },
    deleteDelay: { type: OptionType.NUMBER, default: 800, description: "Delay between deletions (ms)" },
    maxBatch: { type: OptionType.NUMBER, default: 25, description: "Messages per batch" },

    spamMaxLength: { type: OptionType.NUMBER, default: 3, description: "Max length to count as spam (g, ok, .)" },
    trackedDays: { type: OptionType.NUMBER, default: 7, description: "Max message age in days to affect" },

    protectedUsers: {
        type: OptionType.STRING,
        default: "",
        description: "User IDs to NEVER delete (comma separated)",
        placeholder: "123,456,789",
    },
    ignoredBots: {
        type: OptionType.STRING,
        default: "",
        description: "Bot IDs to NEVER delete",
        placeholder: "botId1,botId2",
    },
});

function parseIds(str: string): string[] {
    return str
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

async function searchMessages(channelId: string, offset = 0) {
    const qs = new URLSearchParams({
        include_nsfw: "true",
        offset: String(offset),
        channel_id: channelId,
    }).toString();

    const res = await RestAPI.get({ url: `/channels/${channelId}/messages/search?${qs}` });
    return (res.body?.messages?.flat() ?? []) as any[];
}

function isOld(msg: any): boolean {
    const days = settings.store.trackedDays;
    if (!msg.timestamp) return false;
    const ts = new Date(msg.timestamp).getTime();
    const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return diffDays > days;
}

function isFromProtected(msg: any): boolean {
    const protectedIds = parseIds(settings.store.protectedUsers);
    if (!msg.author?.id) return false;
    return protectedIds.includes(msg.author.id);
}

function isFromIgnoredBot(msg: any): boolean {
    if (!msg.author?.bot) return false;
    const ids = parseIds(settings.store.ignoredBots);
    return ids.includes(msg.author.id);
}

function isShortSpam(msg: any): boolean {
    if (!msg.content) return false;
    const c = msg.content.trim();
    return c.length > 0 && c.length <= settings.store.spamMaxLength;
}

function isMedia(msg: any): boolean {
    return (msg.attachments?.length ?? 0) > 0 || (msg.embeds?.length ?? 0) > 0;
}

async function deleteMsg(channelId: string, id: string) {
    await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
}

type Mode = "spam" | "media" | "between";

async function runCleanup(ctx: any, mode: Mode, extra?: { fromId?: string; toId?: string }) {
    const channelId = ctx.channel.id;
    const state = { running: true, count: 0, start: Date.now() };

    sendBotMessage(channelId, {
        content:
            mode === "spam"
                ? "🧹 بدء تنظيف الرسائل القصيرة/السبام..."
                : mode === "media"
                ? "🧹 حذف رسائل الميديا (صور/فيديو/ملفات)..."
                : "🧹 حذف الرسائل بين رسالتين...",
    });

    try {
        let offset = 0;
        let empty = 0;

        while (state.running && empty < 3) {
            await sleep(settings.store.searchDelay);
            const msgs = await searchMessages(channelId, offset);

            if (!msgs.length) {
                empty++;
                offset = 0;
                continue;
            }

            empty = 0;

            for (const msg of msgs.slice(0, settings.store.maxBatch)) {
                if (!state.running) break;

                if (isOld(msg)) continue;
                if (isFromProtected(msg)) continue;
                if (isFromIgnoredBot(msg)) continue;

                let shouldDelete = false;

                if (mode === "spam") {
                    shouldDelete = isShortSpam(msg);
                } else if (mode === "media") {
                    shouldDelete = isMedia(msg);
                } else if (mode === "between") {
                    const fromId = extra?.fromId;
                    const toId = extra?.toId;
                    if (!fromId || !toId) continue;
                    // between: delete inclusive range
                    if (msg.id === fromId || msg.id === toId) {
                        shouldDelete = true;
                    } else {
                        const idNum = BigInt(msg.id);
                        const a = BigInt(fromId);
                        const b = BigInt(toId);
                        const min = a < b ? a : b;
                        const max = a > b ? a : b;
                        shouldDelete = idNum > min && idNum < max;
                    }
                }

                if (!shouldDelete) continue;

                await sleep(settings.store.deleteDelay);
                try {
                    await deleteMsg(channelId, msg.id);
                    state.count++;
                } catch (e: any) {
                    if (e?.status === 429) {
                        const retry = e?.body?.retry_after
                            ? Math.ceil(e.body.retry_after * 1000)
                            : 5000;
                        await sleep(retry);
                    }
                }
            }

            offset += 25;
        }

        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `✅ انتهى التنظيف (${mode}) | عدد الرسائل: ${state.count} | الوقت: ${elapsed}ث`,
        });
    } catch {
        sendBotMessage(channelId, { content: "❌ صار خطأ أثناء التنظيف." });
    }
}

export default definePlugin({
    name: "SmartCleanup",
    description: "أوامر ذكية لتنظيف الشات (سبام، ميديا، بين رسالتين)",
    authors: [Devs.rz30,],
    settings,
    commands: [
        {
            name: "clean-spam",
            description: "🧹 حذف الرسائل القصيرة/السبام في هذه القناة",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runCleanup(ctx, "spam"),
        },
        {
            name: "clean-media",
            description: "🧹 حذف الرسائل التي تحتوي ميديا (صور/فيديو/ملفات)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runCleanup(ctx, "media"),
        },
        {
            name: "clean-between",
            description: "🧹 حذف الرسائل بين رسالتين (تعطيه ID من–إلى)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "from",
                    description: "Message ID البداية",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
                {
                    name: "to",
                    description: "Message ID النهاية",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: (opts, ctx) => {
                const fromId = String(opts[0].value);
                const toId = String(opts[1].value);
                return runCleanup(ctx, "between", { fromId, toId });
            },
        },
    ],
});
