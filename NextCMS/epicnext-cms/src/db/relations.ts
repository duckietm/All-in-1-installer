import { relations } from "drizzle-orm";
import {
	AclModelPermission,
	AclModelRole,
	AclPermission,
	AclRole,
	AdminAuditLog,
	User,
	WebsiteEvent,
	WebsiteEventPrize,
	WebsiteEventRegistration,
	WebsiteEventType,
	WebsiteEventWinner,
	WebsitePoll,
	WebsitePollQuestion,
	WebsitePollVote,
	WebsiteTicket,
	WebsiteTicketMessage,
} from "@/db/schema";

export const userRelations = relations(User, ({ many }) => ({
	createdTickets: many(WebsiteTicket, { relationName: "ticketCreator" }),
	assignedTickets: many(WebsiteTicket, { relationName: "ticketAssignee" }),
	ticketMessages: many(WebsiteTicketMessage),
	auditLogs: many(AdminAuditLog),
}));

export const websiteTicketRelations = relations(
	WebsiteTicket,
	({ one, many }) => ({
		creator: one(User, {
			fields: [WebsiteTicket.creatorId],
			references: [User.id],
			relationName: "ticketCreator",
		}),
		assignee: one(User, {
			fields: [WebsiteTicket.assigneeId],
			references: [User.id],
			relationName: "ticketAssignee",
		}),
		messages: many(WebsiteTicketMessage),
	}),
);

export const websiteTicketMessageRelations = relations(
	WebsiteTicketMessage,
	({ one }) => ({
		ticket: one(WebsiteTicket, {
			fields: [WebsiteTicketMessage.ticketId],
			references: [WebsiteTicket.id],
		}),
		user: one(User, {
			fields: [WebsiteTicketMessage.userId],
			references: [User.id],
		}),
	}),
);

export const adminAuditLogRelations = relations(AdminAuditLog, ({ one }) => ({
	user: one(User, {
		fields: [AdminAuditLog.userId],
		references: [User.id],
	}),
}));

export const aclRoleRelations = relations(AclRole, ({ many }) => ({
	rolePermissions: many(AclModelPermission),
	modelRoles: many(AclModelRole),
}));

export const aclModelPermissionRelations = relations(
	AclModelPermission,
	({ one }) => ({
		role: one(AclRole, {
			fields: [AclModelPermission.modelId],
			references: [AclRole.id],
		}),
		permission: one(AclPermission, {
			fields: [AclModelPermission.permissionId],
			references: [AclPermission.id],
		}),
	}),
);

export const websiteEventTypeRelations = relations(
	WebsiteEventType,
	({ many }) => ({
		events: many(WebsiteEvent),
	}),
);

export const websiteEventRelations = relations(
	WebsiteEvent,
	({ one, many }) => ({
		type: one(WebsiteEventType, {
			fields: [WebsiteEvent.typeId],
			references: [WebsiteEventType.id],
		}),
		registrations: many(WebsiteEventRegistration),
		prizes: many(WebsiteEventPrize),
		winners: many(WebsiteEventWinner),
	}),
);

export const websiteEventRegistrationRelations = relations(
	WebsiteEventRegistration,
	({ one }) => ({
		event: one(WebsiteEvent, {
			fields: [WebsiteEventRegistration.eventId],
			references: [WebsiteEvent.id],
		}),
	}),
);

export const websiteEventPrizeRelations = relations(
	WebsiteEventPrize,
	({ one }) => ({
		event: one(WebsiteEvent, {
			fields: [WebsiteEventPrize.eventId],
			references: [WebsiteEvent.id],
		}),
	}),
);

export const websiteEventWinnerRelations = relations(
	WebsiteEventWinner,
	({ one }) => ({
		event: one(WebsiteEvent, {
			fields: [WebsiteEventWinner.eventId],
			references: [WebsiteEvent.id],
		}),
	}),
);

export const websitePollRelations = relations(WebsitePoll, ({ many }) => ({
	questions: many(WebsitePollQuestion),
}));

export const websitePollQuestionRelations = relations(
	WebsitePollQuestion,
	({ one, many }) => ({
		poll: one(WebsitePoll, {
			fields: [WebsitePollQuestion.pollId],
			references: [WebsitePoll.id],
		}),
		votes: many(WebsitePollVote),
	}),
);

export const websitePollVoteRelations = relations(
	WebsitePollVote,
	({ one }) => ({
		question: one(WebsitePollQuestion, {
			fields: [WebsitePollVote.questionId],
			references: [WebsitePollQuestion.id],
		}),
	}),
);
