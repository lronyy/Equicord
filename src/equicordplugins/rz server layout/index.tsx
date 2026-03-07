// filename: index.tsx

/*
 * Vencord, a Discord client mod
 * rz user stats
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Devs } from "@utils/constants";
import type { Guild, User } from "@vencord/discord-types";
import {
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalProps,
    ModalRoot,
    ModalSize,
    openModal,
} from "@utils/modal";
import { findStoreLazy } from "@webpack";
import {
    Forms,
    Menu,
    React,
} from "@webpack/common";

const RelationshipStore = findStoreLazy("RelationshipStore");
const PresenceStore = findStoreLazy("PresenceStore");
const GuildStore = findStoreLazy("GuildStore");
const GuildMemberStore = findStoreLazy("GuildMemberStore");

interface UserStatsModalComponentProps {
    modalProps: ModalProps;
    userId: string;
}

function UserStatsModal({ modalProps, userId }: UserStatsModalComponentProps) {
    const relationships = RelationshipStore?.getRelationships?.() || {};
    const relType = relationships[userId];

    const presenceState = PresenceStore?.getState?.();
    const clientStatuses = presenceState?.clientStatuses?.[userId];
    const presenceText = clientStatuses
        ? Object.keys(clientStatuses).join(", ")
        : "Unknown / Offline";

    const allGuilds = GuildStore?.getGuilds?.() || {};
    const memberGuilds: string[] = [];
    for (const id in allGuilds) {
        const member = GuildMemberStore?.getMember?.(id, userId);
        if (member) memberGuilds.push(id);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">
                    rz user stats
                </Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormText>
                    User ID: <code>{userId}</code>
                </Forms.FormText>

                <Forms.FormDivider />

                <Forms.FormTitle tag="h3">
                    Relationship (raw)
                </Forms.FormTitle>
                <Forms.FormText>
                    {String(relType ?? "None / Unknown")}
                </Forms.FormText>

                <Forms.FormDivider />

                <Forms.FormTitle tag="h3">
                    Presence (client statuses)
                </Forms.FormTitle>
                <Forms.FormText>
                    {presenceText}
                </Forms.FormText>

                <Forms.FormDivider />

                <Forms.FormTitle tag="h3">
                    Mutual guild count (approx)
                </Forms.FormTitle>
                <Forms.FormText>
                    {memberGuilds.length}
                </Forms.FormText>
            </ModalContent>
        </ModalRoot>
    );
}

interface UserCtxProps {
    user: User;
    guild?: Guild;
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: UserCtxProps) => {
    if (!user) return;

    children.push(
        <Menu.MenuItem
            id="rz-user-stats"
            key="rz-user-stats"
            label="Show simple stats (rz)"
            action={() => {
                openModal(props => (
                    <UserStatsModal modalProps={props} userId={user.id} />
                ));
            }}
        />
    );
};

export default definePlugin({
    name: "rz user stats",
    description: "مودال بسيط يعرض معلومات raw عن المستخدم (relationship, presence, mutual guild count).",
    authors: [Devs.rz30,],
    contextMenus: {
        "user-context": UserContext,
    },
});
