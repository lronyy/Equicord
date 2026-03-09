import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { UserStore } from "@webpack/common";

const settings = definePluginSettings({
    badgeUrl: {
        type: OptionType.STRING,
        description: "رابط صورة الشارة (PNG أو GIF - 64x64 بكسل)",
        default: "https://cdn.discordapp.com/emojis/YOUR_EMOJI_ID.png",
    },
    badgeTooltip: {
        type: OptionType.STRING,
        description: "النص اللي يظهر لما تمرر الماوس على الشارة",
        default: "شارتي المخصصة ✨",
    },
    badgePosition: {
        type: OptionType.SELECT,
        description: "موقع الشارة",
        options: [
            { label: "أول الشارات", value: "start", default: true },
            { label: "آخر الشارات", value: "end" },
        ],
    },
});

export default definePlugin({
    name: "CustomBadge",
    description: "يضيف شارة مخصصة جنب اسمك تظهر للناس اللي عندهم Vencord",
    authors: [Devs.rz30],

    settings,

    // الـ API الرسمي لـ Vencord لإضافة شارات
    badges: [
        {
            // دالة تحدد على أي يوزر تظهر الشارة
            shouldShow({ userId }: { userId: string }) {
                // تظهر الشارة فقط على حسابك أنت
                return userId === UserStore.getCurrentUser()?.id;
            },

            // بيانات الشارة
            badge({ userId }: { userId: string }) {
                return {
                    // رابط الصورة من الإعدادات
                    image: settings.store.badgeUrl,

                    // النص عند التحويم
                    description: settings.store.badgeTooltip,

                    // موقعها بين باقي الشارات
                    position: settings.store.badgePosition === "start" ? 0 : 999,

                    // عند الضغط على الشارة (اختياري)
                    onClick() {
                        console.log("تم الضغط على الشارة!");
                    },
                };
            },
        },
    ],

    start() {
        console.log("✨ [CustomBadge] تم تفعيل الشارة المخصصة!");
    },

    stop() {
        console.log("✨ [CustomBadge] تم إيقاف الشارة المخصصة");
    },
});
