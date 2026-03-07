/*
 * ClearMessages Pro + استثناء كلمات/حروف
 * /delete /delete-all /stop-delete
 */

import {
    ApplicationCommandInputType,
    sendBotMessage,
} from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    searchDelay: { type: OptionType.NUMBER, default: 800 },
    deleteDelay: { type: OptionType.NUMBER, default: 1200 },
    maxBatch: { type: OptionType.NUMBER, default: 5 },

    // ✅ قائمة الاستثناءات
    excludeWords: {
        type: OptionType.STRING,
        description: "كلمات/حروف لا تحذف (مفصولة بفاصلة)",
        default: "لا تحذف,important,dont,لا,مهم,🚫,⭐",
    },
});

const states: Record<string, any> = {};

// ✅ تحويل قائمة الاستثناءات لـ array
function getExcludeWords() {
    return settings.store.excludeWords
        .split(",")
        .map(w => w.trim().toLowerCase())
        .filter(Boolean);
}

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

function getGuildId(ctx: any): string | null {
    return ctx.guild?.id ?? ctx.guildId ?? null;
}

async function shouldSkipMessage(msg: any, excludeWords: string[]): boolean {
    if (!msg.content) return true;

    const content = msg.content.toLowerCase();
    // ✅ إذا احتوت على أي كلمة من قائمة الاستثناءات
    return excludeWords.some(word => content.includes(word));
}

async function searchMessages(channelId: string, authorId?: string, guildId?: string, offset = 0) {
    const params: any = { include_nsfw: true, offset, channel_id: channelId };
    if (authorId) params.author_id = authorId;

    const qs = new URLSearchParams(params).toString();
    const url = guildId
        ? `/guilds/${guildId}/messages/search?${qs}`
        : `/channels/${channelId}/messages/search?${qs}`;

    try {
        const res = await RestAPI.get({ url });
        return res.body?.messages?.flat() ?? [];
    } catch {
        return [];
    }
}

async function deleteOne(channelId: string, msgId: string) {
    await RestAPI.del({ url: `/channels/${channelId}/messages/${msg.id}` });
}

async function runDelete(ctx: any, mode: "mine" | "all") {
    const channelId = ctx.channel.id;
    const guildId = getGuildId(ctx);
    const state = states[channelId] ??= { running: false, count: 0, skipped: 0, start: 0 };
    const excludeWords = getExcludeWords();

    if (state.running) {
        sendBotMessage(channelId, {
            content: `⏳ قيد التشغيل... (${state.count} حذف | ${state.skipped} مستثنى)`
        });
        return;
    }

    state.running = true;
    state.count = 0;
    state.skipped = 0;
    state.start = Date.now();

    const msg = mode === "mine"
        ? "🧹 حذف رسائلك (مع استثناءات)..."
        : "🔥 حذف الكل (مع استثناءات)...";
    sendBotMessage(channelId, { content: msg });

    try {
        let offset = 0;
        let emptyCount = 0;

        while (state.running && emptyCount < 3) {
            await sleep(settings.store.searchDelay);

            const msgs = await searchMessages(
                channelId,
                mode === "mine" ? UserStore.getCurrentUser().id : undefined,
                guildId,
                offset
            );

            if (!msgs.length) {
                emptyCount++;
                offset = 0;
                continue;
            }

            emptyCount = 0;

            for (const msg of msgs.slice(0, settings.store.maxBatch)) {
                if (!state.running) break;
                if (msg.channel_id !== channelId) continue;
                if (mode === "mine" && msg.author?.id !== UserStore.getCurrentUser().id) continue;

                // ✅ فحص الاستثناءات
                if (await shouldSkipMessage(msg, excludeWords)) {
                    state.skipped++;
                    continue;
                }

                await sleep(settings.store.deleteDelay);
                try {
                    await deleteOne(channelId, msg.id);
                    state.count++;

                    if (state.count % 10 === 0) {
                        const elapsed = Math.round((Date.now() - state.start) / 1000);
                        sendBotMessage(channelId, {
                            content: `⚡ ${state.count} حذف | ${state.skipped} مستثنى | ${elapsed}ث`
                        });
                    }
                } catch (e) {
                    if (e.status === 429) await sleep(e.body?.retry_after * 1000 || 5000);
                }
            }

            offset += 25;
        }

        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `✅ ${state.count} حذف | ${state.skipped} مستثنى | ${elapsed}ث`
        });

    } finally {
        state.running = false;
    }
}

async function stopDelete(ctx: any) {
    const channelId = ctx.channel.id;
    const state = states[channelId];

    if (state?.running) {
        state.running = false;
        const elapsed = Math.round((Date.now() - state.start) / 1000);
        sendBotMessage(channelId, {
            content: `⏹️ توقف | ${state.count} حذف | ${state.skipped} مستثنى`
        });
    } else {
        sendBotMessage(channelId, { content: "🚫 لا يوجد حذف" });
    }
}

export default definePlugin({
    name: "يمسح ابو جدك",
    description: "⚡ حذف سريع + استثناءات + سيرفرات",
    authors:[Devs.rz30,],
    settings,

    commands: [
        {
            name: "delete",
            description: "🧹 احذف رسائلك (يستثني الكلمات المحظورة)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runDelete(ctx, "mine"),
        },
        {
            name: "delete-all",
            description: "🔥 احذف الكل (يستثني الكلمات المحظورة)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => runDelete(ctx, "all"),
        },
        {
            name: "stop-delete",
            description: "⏹️ أوقف الحذف",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_, ctx) => stopDelete(ctx),
        },
    ],
});
