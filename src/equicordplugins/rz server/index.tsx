/*
* Vencord, a Discord client mod
* rz server - Server control plugin
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import {
    GuildChannelStore,
    Menu,
    React,
    RestAPI,
    UserStore,
} from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const GuildMemberStore = findStoreLazy("GuildMemberStore");
const PermissionStore = findStoreLazy("PermissionStore");

const settings = definePluginSettings({
    waitAfter: {
        type: OptionType.SLIDER,
        description: "API actions before waiting (anti rate limit)",
        default: 40,
        markers: makeRange(1, 200),
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "Wait time between batches (seconds)",
        default: 1,
        markers: makeRange(0.5, 10, 0.5),
    },
    emergencyMessage: {
        type: OptionType.STRING,
        description: "Emergency mode message (sent in selected channel, leave empty to disable message)",
        default: "تم تفعيل وضع الطوارئ، الشات مقفول مؤقتاً.",
    },
    voiceScope: {
        type: OptionType.SELECT,
        description: "نطاق أوامر الفويس",
        options: [
            { label: "كل الفويس في السيرفر", value: "all" },
            { label: "فقط الروم اللي أنا فيه", value: "current" },
        ],
        default: "all",
    },
    excludeRoleName: {
        type: OptionType.STRING,
        description: "اسم رول يتم استثناؤه من كل الأكشنات",
        default: "",
    },
    newChannelName: {
        type: OptionType.STRING,
        description: "اسم الشات الجديد عند الضغط على (شات جديد)",
        default: "new-channel",
    },
    newRoleName: {
        type: OptionType.STRING,
        description: "اسم الرول الجديد عند الضغط على (رول جديد)",
        default: "New Role",
    },
    newRoleColor: {
        type: OptionType.STRING,
        description: "لون الرول الجديد (اختياري، HEX مثل #ff0000)",
        default: "",
    },
    ignoreHigherRoles: {
        type: OptionType.BOOLEAN,
        description: "استثناء اللي أعلى مني في الرتب من الأكشنات؟ (شغّال = يستثنيهم)",
        default: true,
    },
});

async function runSequential<T>(promises: Promise<T>[]): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < promises.length; i++) {
        const result = await promises[i];
        results.push(result);

        if (i !== 0 && i % settings.store.waitAfter === 0) {
            await new Promise(resolve =>
                setTimeout(resolve, settings.store.waitSeconds * 1000)
            );
        }
    }

    return results;
}

// هل العضو أعلى مني في الرتب؟
function isHigherThanMe(guildId: string, userId: string): boolean {
    const me = UserStore.getCurrentUser();
    if (!me) return false;

    const meMember = GuildMemberStore.getMember(guildId, me.id);
    const targetMember = GuildMemberStore.getMember(guildId, userId);
    if (!meMember || !targetMember) return false;

    const meHoisted = PermissionStore.getHighestRole(guildId, me.id);
    const targetHoisted = PermissionStore.getHighestRole(guildId, userId);

    if (!meHoisted || !targetHoisted) return false;
    return targetHoisted.position > meHoisted.position;
}

// هل عنده رول مستثنى؟
function hasExcludedRole(guildId: string, userId: string): boolean {
    const name = settings.store.excludeRoleName?.trim();
    if (!name) return false;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member || !member.roles) return false;

    const roles = PermissionStore.getGuildRoles(guildId) || {};
    const lowerName = name.toLowerCase();

    return member.roles.some((roleId: string) => {
        const role = roles[roleId];
        if (!role) return false;
        return String(role.name || "").toLowerCase() === lowerName;
    });
}

/* ================= VOICE CONTROL ================= */

function getVoiceChannelsForScope(guildId: string): Channel[] {
    const guildChannels: { VOCAL: { channel: Channel, comparator: number }[] } =
        GuildChannelStore.getChannels(guildId);
    const allVoice = guildChannels.VOCAL.map(({ channel }) => channel);

    if (settings.store.voiceScope === "current") {
        const meId = UserStore.getCurrentUser().id;
        const current = allVoice.find(vc => {
            const users = VoiceStateStore.getVoiceStatesForChannel(vc.id);
            return Object.values(users).some((s: any) => (s as any).userId === meId);
        });
        return current ? [current] : [];
    }

    return allVoice;
}

function voiceActionAll(
    guildId: string,
    body: Record<string, any>,
    targetChannelId?: string
) {
    const myId = UserStore.getCurrentUser().id;
    const voiceChannels = getVoiceChannelsForScope(guildId);
    const promises: Promise<unknown>[] = [];

    voiceChannels.forEach(channel => {
        const usersVoice = VoiceStateStore.getVoiceStatesForChannel(channel.id);

        Object.keys(usersVoice).forEach(key => {
            const userVoice = (usersVoice as any)[key];

            if (userVoice.userId === myId) return;

            if (settings.store.ignoreHigherRoles && isHigherThanMe(guildId, userVoice.userId)) {
                return;
            }

            if (hasExcludedRole(guildId, userVoice.userId)) return;

            const patchBody = targetChannelId
                ? { channel_id: targetChannelId }
                : body;

            promises.push(
                RestAPI.patch({
                    url: `/guilds/${guildId}/members/${userVoice.userId}`,
                    body: patchBody,
                })
            );
        });
    });

    runSequential(promises).catch(err =>
        console.error("rz server voiceActionAll error", err)
    );
}

/* ================= TEXT CONTROL ================= */

function getTextChannels(guildId: string): Channel[] {
    const guildChannels = GuildChannelStore.getChannels(guildId) as any;
    const text = (guildChannels.TEXT ?? []).map((x: any) => x.channel as Channel);
    const news = (guildChannels.NEWS ?? []).map((x: any) => x.channel as Channel);
    return [...text, ...news];
}

function setLockAllText(guildId: string, lock: boolean) {
    const channels = getTextChannels(guildId);
    const promises: Promise<unknown>[] = [];

    channels.forEach(ch => {
        promises.push(
            RestAPI.patch({
                url: `/channels/${ch.id}`,
                body: {
                    permission_overwrites: [
                        {
                            id: guildId, // @everyone
                            type: 0,
                            deny: lock ? "1024" : "0", // SEND_MESSAGES bit
                        },
                    ],
                },
            })
        );
    });

    runSequential(promises).catch(err =>
        console.error("rz server setLockAllText error", err)
    );
}

function emergencyMode(guildId: string, enable: boolean, messageChannelId?: string) {
    setLockAllText(guildId, enable);

    const msg = settings.store.emergencyMessage?.trim();
    if (enable && messageChannelId && msg.length > 0) {
        RestAPI.post({
            url: `/channels/${messageChannelId}/messages`,
            body: {
                content: msg,
            },
        }).catch(err =>
            console.error("rz server emergency message error", err)
        );
    }
}

/* ================= CREATE ROLE / CHANNEL ================= */

async function createRoleFromSettings(guildId: string) {
    const name = settings.store.newRoleName.trim();
    if (!name) return;

    const body: any = {
        name,
        hoist: false,
        mentionable: false,
    };

    const colorTrim = settings.store.newRoleColor.trim();
    if (colorTrim.startsWith("#") && colorTrim.length === 7) {
        try {
            body.color = parseInt(colorTrim.slice(1), 16);
        } catch {
            // ignore invalid color
        }
    }

    try {
        await RestAPI.post({
            url: `/guilds/${guildId}/roles`,
            body,
        });
    } catch (e) {
        console.error("rz server create role error", e);
    }
}

async function createChannelFromSettings(guildId: string) {
    const name = settings.store.newChannelName.trim();
    if (!name) return;

    try {
        await RestAPI.post({
            url: `/guilds/${guildId}/channels`,
            body: {
                name,
                type: 0, // GUILD_TEXT
            },
        });
    } catch (e) {
        console.error("rz server create channel error", e);
    }
}

/* =============== CONTEXT MENU UI =============== */

interface GuildContextProps {
    guild: {
        id: string;
        name: string;
    };
}

const GuildContext: NavContextMenuPatchCallback = (children, props: GuildContextProps) => {
    const { guild } = props;
    if (!guild) return;

    const guildId = guild.id;

    const voiceChannels = getVoiceChannelsForScope(guildId);
    let totalUsers = 0;
    voiceChannels.forEach(channel => {
        totalUsers += Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id)).length;
    });

    const scopeLabel =
        settings.store.voiceScope === "current"
            ? "النطاق: بس نفس الروم"
            : "النطاق: كل الفويس";

    children.splice(
        -1,
        0,
        <Menu.MenuGroup label="كنترول سيرفر – rz server">
            {/* Voice control */}
            {totalUsers > 0 && (
                <Menu.MenuItem
                    id="rz-voice-group"
                    label="التحكم في الفويس"
                    children={
                        <Menu.MenuGroup>
                            <Menu.MenuItem
                                id="rz-voice-disconnect-all"
                                label="Disconnect الكل من الفويس"
                                action={() => voiceActionAll(guildId, { channel_id: null })}
                            />
                            <Menu.MenuItem
                                id="rz-voice-mute-all"
                                label="Mute الكل في الفويس"
                                action={() => voiceActionAll(guildId, { mute: true })}
                            />
                            <Menu.MenuItem
                                id="rz-voice-unmute-all"
                                label="Unmute الكل في الفويس"
                                action={() => voiceActionAll(guildId, { mute: false })}
                            />
                            <Menu.MenuItem
                                id="rz-voice-deafen-all"
                                label="Deafen الكل في الفويس"
                                action={() => voiceActionAll(guildId, { deaf: true })}
                            />
                            <Menu.MenuItem
                                id="rz-voice-undeafen-all"
                                label="Undeafen الكل في الفويس"
                                action={() => voiceActionAll(guildId, { deaf: false })}
                            />
                            {voiceChannels.map(vc => (
                                <Menu.MenuItem
                                    id={`rz-voice-move-all-${vc.id}`}
                                    label={`Move الكل إلى ${vc.name}`}
                                    action={() => voiceActionAll(guildId, {}, vc.id)}
                                />
                            ))}
                        </Menu.MenuGroup>
                    }
                />
            )}

            {/* Voice scope toggle */}
            <Menu.MenuItem
                id="rz-voice-scope-toggle"
                label={scopeLabel}
                action={() => {
                    settings.store.voiceScope =
                        settings.store.voiceScope === "all" ? "current" : "all";
                }}
            />

            {/* Text control */}
            <Menu.MenuItem
                id="rz-text-group"
                label="التحكم في الشات"
                children={
                    <Menu.MenuGroup>
                        <Menu.MenuItem
                            id="rz-text-lock-all"
                            label="قفل كل رومات الكتابة"
                            action={() => setLockAllText(guildId, true)}
                        />
                        <Menu.MenuItem
                            id="rz-text-unlock-all"
                            label="فتح كل رومات الكتابة"
                            action={() => setLockAllText(guildId, false)}
                        />
                        <Menu.MenuItem
                            id="rz-text-new-channel"
                            label="شات جديد"
                            action={() => createChannelFromSettings(guildId)}
                        />
                    </Menu.MenuGroup>
                }
            />

            {/* Roles / new role */}
            <Menu.MenuItem
                id="rz-role-group"
                label="الرولات"
                children={
                    <Menu.MenuGroup>
                        <Menu.MenuItem
                            id="rz-role-new"
                            label="رول جديد"
                            action={() => createRoleFromSettings(guildId)}
                        />
                    </Menu.MenuGroup>
                }
            />

            {/* Emergency mode */}
            <Menu.MenuItem
                id="rz-emergency-group"
                label="وضع الطوارئ"
                children={
                    <Menu.MenuGroup>
                        <Menu.MenuItem
                            id="rz-emergency-enable"
                            label="تفعيل وضع الطوارئ (قفل الكل + رسالة)"
                            action={() => {
                                const textChannels = getTextChannels(guildId);
                                const defaultChannel = textChannels[0];
                                emergencyMode(
                                    guildId,
                                    true,
                                    defaultChannel ? defaultChannel.id : undefined
                                );
                            }}
                        />
                        <Menu.MenuItem
                            id="rz-emergency-disable"
                            label="إلغاء وضع الطوارئ (فتح الكل)"
                            action={() => emergencyMode(guildId, false)}
                        />
                    </Menu.MenuGroup>
                }
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "rz server",
    description: "Advanced server control: voice, scopes, safe exclusions, text lock, emergency mode, and quick create (roles/channels) from settings and menu.",
    authors: [Devs.rz30,],
    settings,
    contextMenus: {
        "guild-context": GuildContext,
    },
});
