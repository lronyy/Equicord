/*
 * Vencord, a modification for Discord's desktop app
 * rz auto reply - Auto reply plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { DeleteIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, makeRange } from "@utils/types";
import { findStoreLazy } from "@webpack";
import {
    Button,
    Forms,
    React,
    RestAPI,
    TextInput,
    UserStore,
    useState
} from "@webpack/common";

const MessageStore = findStoreLazy("MessageStore");
const ChannelStore = findStoreLazy("ChannelStore");

type Rule = {
    trigger: string;
    reply: string;
};

const makeEmptyRule = (): Rule => ({ trigger: "", reply: "" });
const makeEmptyRuleArray = () => [makeEmptyRule()];

const settings = definePluginSettings({
    rulesEditor: {
        type: OptionType.COMPONENT,
        component: () => {
            const { rules } = settings.use(["rules"]);

            return (
                <>
                    <AutoReplyRulesEditor rulesArray={rules} />
                    <Forms.FormDivider />
                    <AutoReplyInfo />
                </>
            );
        }
    },
    rules: {
        type: OptionType.CUSTOM,
        default: makeEmptyRuleArray(),
    },

    // عام
    enabled: {
        type: OptionType.BOOLEAN,
        description: "تفعيل الرد التلقائي",
        default: true,
    },
    replyInDMs: {
        type: OptionType.BOOLEAN,
        description: "الرد في الخاص (DMs)",
        default: true,
    },
    replyInGuilds: {
        type: OptionType.BOOLEAN,
        description: "الرد في السيرفرات",
        default: true,
    },
    replyToMentions: {
        type: OptionType.BOOLEAN,
        description: "الرد إذا أحد منشنك",
        default: true,
    },
    replyToKeywords: {
        type: OptionType.BOOLEAN,
        description: "الرد إذا الرسالة تحتوي تريقر من القواعد",
        default: true,
    },
    replyToAllMessages: {
        type: OptionType.BOOLEAN,
        description: "الرد على كل الرسائل (انتبه من السبام)",
        default: false,
    },
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "تجاهل رسائل البوتات (ما عدا وضع الترحيب لو مفعّل)",
        default: true,
    },
    maxRepliesPerMinute: {
        type: OptionType.SLIDER,
        description: "أقصى عدد ردود في الدقيقة",
        default: 5,
        markers: makeRange(1, 30),
    },

    // وضع الترحيب
    welcomeEnabled: {
        type: OptionType.BOOLEAN,
        description: "تفعيل وضع الترحيب التلقائي",
        default: true,
    },
    welcomeBotIds: {
        type: OptionType.STRING,
        description: "IDs بوتات الترحيب (مفصولة بفاصلة ،) اتركه فاضي لأي بوت",
        default: "",
    },
    welcomeTriggerText: {
        type: OptionType.STRING,
        description: "كلمة/جملة لو ظهرت في رسالة الترحيب، يرسل رد الترحيب",
        default: "welcome",
    },
    welcomeReplyText: {
        type: OptionType.STRING,
        description: "رسالة الترحيب اللي يرسلها البلوقن",
        default: "حياك الله نورت السيرفر 🤍",
    },
});

let replyHistory: number[] = [];

/* ============ UI COMPONENTS (Editor) ============ */

function Input({
    initialValue,
    onChange,
    placeholder,
}: {
    placeholder: string;
    initialValue: string;
    onChange(value: string): void;
}) {
    const [value, setValue] = useState(initialValue);
    return (
        <TextInput
            placeholder={placeholder}
            value={value}
            onChange={setValue}
            spellCheck={false}
            onBlur={() => value !== initialValue && onChange(value)}
        />
    );
}

function AutoReplyRulesEditor({ rulesArray }: { rulesArray: Rule[] }) {
    async function onClickRemove(index: number) {
        if (index === rulesArray.length - 1) return;
        rulesArray.splice(index, 1);
    }

    async function onChange(e: string, index: number, key: keyof Rule) {
        if (index === rulesArray.length - 1) {
            rulesArray.push(makeEmptyRule());
        }

        rulesArray[index][key] = e;

        if (
            rulesArray[index].trigger === "" &&
            rulesArray[index].reply === "" &&
            index !== rulesArray.length - 1
        ) {
            rulesArray.splice(index, 1);
        }
    }

    return (
        <>
            <Forms.FormTitle tag="h4">قواعد الرد التلقائي</Forms.FormTitle>
            <Forms.FormText type="description">
                كل صف يمثل قاعدة: التريقر (الكلام اللي يطّلق الرد) + الرد اللي يرسله البلوقن.
            </Forms.FormText>
            <Flex flexDirection="column" style={{ gap: "0.5em", marginTop: "0.5em" }}>
                {rulesArray.map((rule, index) => (
                    <React.Fragment key={`${rule.trigger}-${index}`}>
                        <Flex
                            gap="0.5em"
                            flexDirection="row"
                            style={{ flexGrow: 1, alignItems: "center" }}
                        >
                            <Input
                                placeholder="الكلام / التريقر (مثال: سلام)"
                                initialValue={rule.trigger}
                                onChange={e => onChange(e, index, "trigger")}
                            />
                            <Input
                                placeholder="الرد (مثال: وعليكم السلام)"
                                initialValue={rule.reply}
                                onChange={e => onChange(e, index, "reply")}
                            />
                            <Button
                                size={Button.Sizes.MIN}
                                onClick={() => onClickRemove(index)}
                                style={{
                                    background: "none",
                                    color: "var(--status-danger)",
                                    ...(index === rulesArray.length - 1
                                        ? {
                                            visibility: "hidden",
                                            pointerEvents: "none",
                                        }
                                        : {}),
                                }}
                            >
                                <DeleteIcon />
                            </Button>
                        </Flex>
                    </React.Fragment>
                ))}
            </Flex>
        </>
    );
}

function AutoReplyInfo() {
    return (
        <>
            <Forms.FormTitle tag="h4">كيف يشتغل؟</Forms.FormTitle>
            <Forms.FormText type="description">
                البلوقن يشيّك القواعد بالترتيب، وأول تريقر يلقى نصّه داخل الرسالة (contains) يرسل الرد حقّه.
                وضع الترحيب يشتغل أولاً لو رسالة من بوت ترحيب وفيها التريقر المحدد، ويرسل رسالة الترحيب الخاصة.
            </Forms.FormText>
        </>
    );
}

/* ============ Logic Helpers ============ */

function cleanupHistory() {
    const now = Date.now();
    replyHistory = replyHistory.filter(ts => now - ts < 60_000);
}

function canReply() {
    cleanupHistory();
    return replyHistory.length < settings.store.maxRepliesPerMinute;
}

function markReply() {
    replyHistory.push(Date.now());
}

function parseIdList(str: string): string[] {
    return str
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function getRules(): Rule[] {
    const rules = settings.store.rules as Rule[];
    const cleaned: Rule[] = [];
    for (const r of rules) {
        if (!r) continue;
        const trigger = (r.trigger ?? "").trim();
        const reply = (r.reply ?? "").trim();
        if (!trigger && !reply) continue;
        cleaned.push({ trigger, reply });
    }
    return cleaned;
}

function getReplyForMessage(content: string): string | null {
    const rules = getRules();
    const lowered = content.toLowerCase();

    for (const rule of rules) {
        const t = rule.trigger.toLowerCase();
        if (!t) continue;
        if (lowered.includes(t)) {
            return rule.reply;
        }
    }

    return null;
}

function isWelcomeMessage(message: any): boolean {
    if (!settings.store.welcomeEnabled) return false;

    const content: string = message.content || "";
    const trigger = (settings.store.welcomeTriggerText || "").trim();
    if (!trigger) return false;

    const lowered = content.toLowerCase();
    const t = trigger.toLowerCase();

    if (!lowered.includes(t)) return false;

    const botIds = parseIdList(settings.store.welcomeBotIds);
    if (botIds.length === 0) {
        // أي بوت (غالباً بوت ترحيب)
        return !!message.author?.bot;
    }

    return botIds.includes(message.author?.id);
}

/* ============ Message Handling ============ */

let unpatch: (() => void) | null = null;

async function handleMessage(message: any) {
    if (!settings.store.enabled) return;

    const me = UserStore.getCurrentUser();
    if (!me) return;
    if (!message || !message.id) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return;

    const isDM = channel.type === 1 || channel.type === 3; // DM / GROUP_DM

    // فلترة عامّة
    if (isDM && !settings.store.replyInDMs) return;
    if (!isDM && !settings.store.replyInGuilds) return;

    // تجاهل رسائلك أنت
    if (message.author?.id === me.id) return;

    const content: string = message.content || "";

    // أولوية: وضع الترحيب
    if (isWelcomeMessage(message)) {
        if (!canReply()) return;
        markReply();

        const replyText = (settings.store.welcomeReplyText || "").trim();
        if (!replyText) return;

        try {
            await RestAPI.post({
                url: `/channels/${message.channel_id}/messages`,
                body: {
                    content: replyText,
                    message_reference: {
                        message_id: message.id,
                        channel_id: message.channel_id,
                        guild_id: channel.guild_id,
                        fail_if_not_exists: false,
                    },
                },
            });
        } catch (e) {
            console.error("rz auto reply welcome error", e);
        }

        return;
    }

    // من هنا: منطق الرد العادي

    // تجاهل البوتات لو الخيار شغّال
    if (settings.store.ignoreBots && message.author?.bot) return;

    let shouldReply = false;
    let replyText: string | null = null;

    // منشن
    if (settings.store.replyToMentions && Array.isArray(message.mentions)) {
        if (message.mentions.some((m: any) => m.id === me.id)) {
            shouldReply = true;
        }
    }

    // كلمات (قواعدك)
    if (!shouldReply && settings.store.replyToKeywords) {
        replyText = getReplyForMessage(content);
        if (replyText) {
            shouldReply = true;
        }
    }

    // كل الرسائل
    if (!shouldReply && settings.store.replyToAllMessages) {
        shouldReply = true;
    }

    if (!shouldReply) return;

    if (!replyText) {
        const rules = getRules();
        replyText = rules[0]?.reply || null;
    }

    if (!replyText) return;
    if (!canReply()) return;
    markReply();

    try {
        await RestAPI.post({
            url: `/channels/${message.channel_id}/messages`,
            body: {
                content: replyText,
                message_reference: {
                    message_id: message.id,
                    channel_id: message.channel_id,
                    guild_id: channel.guild_id,
                    fail_if_not_exists: false,
                },
            },
        });
    } catch (e) {
        console.error("rz auto reply error", e);
    }
}

function startListener() {
    if (unpatch) return;

    if (!MessageStore || !MessageStore.__emitLocal) {
        console.warn("rz auto reply: MessageStore.__emitLocal غير موجود، تحتاج تعدّل طريقة الربط حسب نسخة Vencord عندك");
        return;
    }

    const original = MessageStore.__emitLocal;

    MessageStore.__emitLocal = (event: any) => {
        try {
            // نتعامل فقط مع MESSAGE_CREATE ونترك باقي الأنواع (MESSAGE_DELETE, UPDATE, ...)
            if (event?.type === "MESSAGE_CREATE" && event?.message) {
                handleMessage(event.message);
            }
        } catch (e) {
            console.error("rz auto reply handle event error", e);
        }

        return original.call(MessageStore, event);
    };

    unpatch = () => {
        MessageStore.__emitLocal = original;
        unpatch = null;
    };
}

function stopListener() {
    if (unpatch) {
        unpatch();
    }
}

/* ============ Plugin ============ */

export default definePlugin({
    name: "rz auto reply",
    description: "Auto reply with dynamic trigger/reply rules and welcome-bot support.",
    authors: [Devs.r3r1, Devs.rz30,],
    settings,
    start() {
        startListener();
    },
    stop() {
        stopListener();
    },
});
