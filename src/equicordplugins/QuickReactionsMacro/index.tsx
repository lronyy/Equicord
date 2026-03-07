// src/userplugins/QuickReactionsMacro/index.tsx
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { RestAPI, UserStore } from "@webpack/common";
import { Devs } from "@utils/constants";

const settings = definePluginSettings({
    profileGaming: {
        type: OptionType.STRING,
        description: "إيموجيات بروفايل Gaming (مفصولة بمسافة أو فاصلة)",
        default: "🔥 😂 💀 GG",
    },
    profileStudy: {
        type: OptionType.STRING,
        description: "إيموجيات بروفايل Study",
        default: "✅ 📚 👍",
    },
});

function parseEmojis(str: string): string[] {
    return str
        .split(/[, ]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

async function addReaction(channelId: string, messageId: string, emoji: string) {
    // نتوقع emoji يكون Unicode فقط
    const encoded = encodeURIComponent(emoji);
    await RestAPI.put({
        url: `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
    });
}

async function runMacro(profile: "gaming" | "study", ctx: any, messageId: string) {
    const channelId = ctx.channel.id;
    const emojis =
        profile === "gaming"
            ? parseEmojis(settings.store.profileGaming)
            : parseEmojis(settings.store.profileStudy);

    for (const e of emojis) {
        try {
            await addReaction(channelId, messageId, e);
        } catch {
            // تجاهل الأخطاء البسيطة
        }
    }
}

export default definePlugin({
    name: "QuickReactionsMacro",
    description: "يضيف مجموعة رياكشنات جاهزة على رسالة بأمر واحد",
    authors:[Devs.rz30,],
    settings,

    commands: [
        {
            name: "react-gaming",
            description: "🎮 أضف رياكشنات Gaming على رسالة",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message_id",
                    description: "ID الرسالة",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: (opts, ctx) => {
                const id = String(opts[0].value);
                return runMacro("gaming", ctx, id);
            },
        },
        {
            name: "react-study",
            description: "📚 أضف رياكشنات Study على رسالة",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "message_id",
                    description: "ID الرسالة",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: (opts, ctx) => {
                const id = String(opts[0].value);
                return runMacro("study", ctx, id);
            },
        },
    ],
});
