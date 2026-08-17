import { relations } from "drizzle-orm/relations";
import { usersInWms, userSessionInWms, userVerificationTokenInWms, cityInWms, stateInWms, countryInWms, warehouseTypeInWms, vehicleTypeInWms, warehouseInWms, importerInWms, importerClientInWms, salesAgentClientInWms, transporterInWms, vehicleInWms, roleInWms, roleCreationRuleInWms, userRoleAssignmentInWms, permissionOverrideInWms, permissionInWms, notificationTemplateInWms, notificationEventInWms, notificationInWms, notificationRuleInWms, notificationQuietHoursInWms, notificationDeliveryInWms, userDeviceInWms, rolePermissionInWms, notificationPreferenceInWms, warehouseTransporterInWms } from "./schema";

export const usersInWmsRelations = relations(usersInWms, ({one, many}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [usersInWms.createdBy],
		references: [usersInWms.id],
		relationName: "usersInWms_createdBy_usersInWms_id"
	}),
	usersInWms_createdBy: many(usersInWms, {
		relationName: "usersInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deactivatedBy: one(usersInWms, {
		fields: [usersInWms.deactivatedBy],
		references: [usersInWms.id],
		relationName: "usersInWms_deactivatedBy_usersInWms_id"
	}),
	usersInWms_deactivatedBy: many(usersInWms, {
		relationName: "usersInWms_deactivatedBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [usersInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "usersInWms_deletedBy_usersInWms_id"
	}),
	usersInWms_deletedBy: many(usersInWms, {
		relationName: "usersInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [usersInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "usersInWms_updatedBy_usersInWms_id"
	}),
	usersInWms_updatedBy: many(usersInWms, {
		relationName: "usersInWms_updatedBy_usersInWms_id"
	}),
	userSessionInWms: many(userSessionInWms),
	userVerificationTokenInWms: many(userVerificationTokenInWms),
	cityInWms_createdBy: many(cityInWms, {
		relationName: "cityInWms_createdBy_usersInWms_id"
	}),
	cityInWms_deletedBy: many(cityInWms, {
		relationName: "cityInWms_deletedBy_usersInWms_id"
	}),
	cityInWms_updatedBy: many(cityInWms, {
		relationName: "cityInWms_updatedBy_usersInWms_id"
	}),
	countryInWms_createdBy: many(countryInWms, {
		relationName: "countryInWms_createdBy_usersInWms_id"
	}),
	countryInWms_deletedBy: many(countryInWms, {
		relationName: "countryInWms_deletedBy_usersInWms_id"
	}),
	countryInWms_updatedBy: many(countryInWms, {
		relationName: "countryInWms_updatedBy_usersInWms_id"
	}),
	stateInWms_createdBy: many(stateInWms, {
		relationName: "stateInWms_createdBy_usersInWms_id"
	}),
	stateInWms_deletedBy: many(stateInWms, {
		relationName: "stateInWms_deletedBy_usersInWms_id"
	}),
	stateInWms_updatedBy: many(stateInWms, {
		relationName: "stateInWms_updatedBy_usersInWms_id"
	}),
	warehouseTypeInWms_createdBy: many(warehouseTypeInWms, {
		relationName: "warehouseTypeInWms_createdBy_usersInWms_id"
	}),
	warehouseTypeInWms_deletedBy: many(warehouseTypeInWms, {
		relationName: "warehouseTypeInWms_deletedBy_usersInWms_id"
	}),
	warehouseTypeInWms_updatedBy: many(warehouseTypeInWms, {
		relationName: "warehouseTypeInWms_updatedBy_usersInWms_id"
	}),
	vehicleTypeInWms_createdBy: many(vehicleTypeInWms, {
		relationName: "vehicleTypeInWms_createdBy_usersInWms_id"
	}),
	vehicleTypeInWms_deletedBy: many(vehicleTypeInWms, {
		relationName: "vehicleTypeInWms_deletedBy_usersInWms_id"
	}),
	vehicleTypeInWms_updatedBy: many(vehicleTypeInWms, {
		relationName: "vehicleTypeInWms_updatedBy_usersInWms_id"
	}),
	warehouseInWms_createdBy: many(warehouseInWms, {
		relationName: "warehouseInWms_createdBy_usersInWms_id"
	}),
	warehouseInWms_deletedBy: many(warehouseInWms, {
		relationName: "warehouseInWms_deletedBy_usersInWms_id"
	}),
	warehouseInWms_updatedBy: many(warehouseInWms, {
		relationName: "warehouseInWms_updatedBy_usersInWms_id"
	}),
	importerInWms_approvedBy: many(importerInWms, {
		relationName: "importerInWms_approvedBy_usersInWms_id"
	}),
	importerInWms_createdBy: many(importerInWms, {
		relationName: "importerInWms_createdBy_usersInWms_id"
	}),
	importerInWms_deletedBy: many(importerInWms, {
		relationName: "importerInWms_deletedBy_usersInWms_id"
	}),
	importerInWms_rejectedBy: many(importerInWms, {
		relationName: "importerInWms_rejectedBy_usersInWms_id"
	}),
	importerInWms_updatedBy: many(importerInWms, {
		relationName: "importerInWms_updatedBy_usersInWms_id"
	}),
	importerClientInWms_createdBy: many(importerClientInWms, {
		relationName: "importerClientInWms_createdBy_usersInWms_id"
	}),
	importerClientInWms_deletedBy: many(importerClientInWms, {
		relationName: "importerClientInWms_deletedBy_usersInWms_id"
	}),
	importerClientInWms_updatedBy: many(importerClientInWms, {
		relationName: "importerClientInWms_updatedBy_usersInWms_id"
	}),
	salesAgentClientInWms_agentUserId: many(salesAgentClientInWms, {
		relationName: "salesAgentClientInWms_agentUserId_usersInWms_id"
	}),
	salesAgentClientInWms_assignedBy: many(salesAgentClientInWms, {
		relationName: "salesAgentClientInWms_assignedBy_usersInWms_id"
	}),
	salesAgentClientInWms_revokedBy: many(salesAgentClientInWms, {
		relationName: "salesAgentClientInWms_revokedBy_usersInWms_id"
	}),
	transporterInWms_createdBy: many(transporterInWms, {
		relationName: "transporterInWms_createdBy_usersInWms_id"
	}),
	transporterInWms_deletedBy: many(transporterInWms, {
		relationName: "transporterInWms_deletedBy_usersInWms_id"
	}),
	transporterInWms_updatedBy: many(transporterInWms, {
		relationName: "transporterInWms_updatedBy_usersInWms_id"
	}),
	vehicleInWms_createdBy: many(vehicleInWms, {
		relationName: "vehicleInWms_createdBy_usersInWms_id"
	}),
	vehicleInWms_deletedBy: many(vehicleInWms, {
		relationName: "vehicleInWms_deletedBy_usersInWms_id"
	}),
	vehicleInWms_updatedBy: many(vehicleInWms, {
		relationName: "vehicleInWms_updatedBy_usersInWms_id"
	}),
	userRoleAssignmentInWms_assignedBy: many(userRoleAssignmentInWms, {
		relationName: "userRoleAssignmentInWms_assignedBy_usersInWms_id"
	}),
	userRoleAssignmentInWms_revokedBy: many(userRoleAssignmentInWms, {
		relationName: "userRoleAssignmentInWms_revokedBy_usersInWms_id"
	}),
	userRoleAssignmentInWms_userId: many(userRoleAssignmentInWms, {
		relationName: "userRoleAssignmentInWms_userId_usersInWms_id"
	}),
	permissionOverrideInWms_grantedBy: many(permissionOverrideInWms, {
		relationName: "permissionOverrideInWms_grantedBy_usersInWms_id"
	}),
	permissionOverrideInWms_userId: many(permissionOverrideInWms, {
		relationName: "permissionOverrideInWms_userId_usersInWms_id"
	}),
	notificationTemplateInWms_createdBy: many(notificationTemplateInWms, {
		relationName: "notificationTemplateInWms_createdBy_usersInWms_id"
	}),
	notificationTemplateInWms_updatedBy: many(notificationTemplateInWms, {
		relationName: "notificationTemplateInWms_updatedBy_usersInWms_id"
	}),
	notificationInWms_actorUserId: many(notificationInWms, {
		relationName: "notificationInWms_actorUserId_usersInWms_id"
	}),
	notificationInWms_recipientUserId: many(notificationInWms, {
		relationName: "notificationInWms_recipientUserId_usersInWms_id"
	}),
	notificationQuietHoursInWms: many(notificationQuietHoursInWms),
	userDeviceInWms: many(userDeviceInWms),
	notificationPreferenceInWms: many(notificationPreferenceInWms),
	warehouseTransporterInWms: many(warehouseTransporterInWms),
}));

export const userSessionInWmsRelations = relations(userSessionInWms, ({one}) => ({
	usersInWm: one(usersInWms, {
		fields: [userSessionInWms.userId],
		references: [usersInWms.id]
	}),
}));

export const userVerificationTokenInWmsRelations = relations(userVerificationTokenInWms, ({one}) => ({
	usersInWm: one(usersInWms, {
		fields: [userVerificationTokenInWms.userId],
		references: [usersInWms.id]
	}),
}));

export const cityInWmsRelations = relations(cityInWms, ({one, many}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [cityInWms.createdBy],
		references: [usersInWms.id],
		relationName: "cityInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [cityInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "cityInWms_deletedBy_usersInWms_id"
	}),
	stateInWm: one(stateInWms, {
		fields: [cityInWms.stateId],
		references: [stateInWms.id]
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [cityInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "cityInWms_updatedBy_usersInWms_id"
	}),
	warehouseInWms: many(warehouseInWms),
	importerInWms: many(importerInWms),
	importerClientInWms: many(importerClientInWms),
	transporterInWms: many(transporterInWms),
}));

export const stateInWmsRelations = relations(stateInWms, ({one, many}) => ({
	cityInWms: many(cityInWms),
	countryInWm: one(countryInWms, {
		fields: [stateInWms.countryId],
		references: [countryInWms.id]
	}),
	usersInWm_createdBy: one(usersInWms, {
		fields: [stateInWms.createdBy],
		references: [usersInWms.id],
		relationName: "stateInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [stateInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "stateInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [stateInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "stateInWms_updatedBy_usersInWms_id"
	}),
}));

export const countryInWmsRelations = relations(countryInWms, ({one, many}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [countryInWms.createdBy],
		references: [usersInWms.id],
		relationName: "countryInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [countryInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "countryInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [countryInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "countryInWms_updatedBy_usersInWms_id"
	}),
	stateInWms: many(stateInWms),
}));

export const warehouseTypeInWmsRelations = relations(warehouseTypeInWms, ({one, many}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [warehouseTypeInWms.createdBy],
		references: [usersInWms.id],
		relationName: "warehouseTypeInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [warehouseTypeInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "warehouseTypeInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [warehouseTypeInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "warehouseTypeInWms_updatedBy_usersInWms_id"
	}),
	warehouseInWms: many(warehouseInWms),
}));

export const vehicleTypeInWmsRelations = relations(vehicleTypeInWms, ({one, many}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [vehicleTypeInWms.createdBy],
		references: [usersInWms.id],
		relationName: "vehicleTypeInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [vehicleTypeInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "vehicleTypeInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [vehicleTypeInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "vehicleTypeInWms_updatedBy_usersInWms_id"
	}),
	vehicleInWms: many(vehicleInWms),
}));

export const warehouseInWmsRelations = relations(warehouseInWms, ({one, many}) => ({
	cityInWm: one(cityInWms, {
		fields: [warehouseInWms.cityId],
		references: [cityInWms.id]
	}),
	usersInWm_createdBy: one(usersInWms, {
		fields: [warehouseInWms.createdBy],
		references: [usersInWms.id],
		relationName: "warehouseInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [warehouseInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "warehouseInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [warehouseInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "warehouseInWms_updatedBy_usersInWms_id"
	}),
	warehouseTypeInWm: one(warehouseTypeInWms, {
		fields: [warehouseInWms.warehouseTypeId],
		references: [warehouseTypeInWms.id]
	}),
	userRoleAssignmentInWms: many(userRoleAssignmentInWms),
	notificationInWms: many(notificationInWms),
	warehouseTransporterInWms: many(warehouseTransporterInWms),
}));

export const importerInWmsRelations = relations(importerInWms, ({one, many}) => ({
	usersInWm_approvedBy: one(usersInWms, {
		fields: [importerInWms.approvedBy],
		references: [usersInWms.id],
		relationName: "importerInWms_approvedBy_usersInWms_id"
	}),
	cityInWm: one(cityInWms, {
		fields: [importerInWms.cityId],
		references: [cityInWms.id]
	}),
	usersInWm_createdBy: one(usersInWms, {
		fields: [importerInWms.createdBy],
		references: [usersInWms.id],
		relationName: "importerInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [importerInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "importerInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_rejectedBy: one(usersInWms, {
		fields: [importerInWms.rejectedBy],
		references: [usersInWms.id],
		relationName: "importerInWms_rejectedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [importerInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "importerInWms_updatedBy_usersInWms_id"
	}),
	importerClientInWms: many(importerClientInWms),
	userRoleAssignmentInWms: many(userRoleAssignmentInWms),
	notificationInWms: many(notificationInWms),
}));

export const importerClientInWmsRelations = relations(importerClientInWms, ({one, many}) => ({
	cityInWm: one(cityInWms, {
		fields: [importerClientInWms.cityId],
		references: [cityInWms.id]
	}),
	usersInWm_createdBy: one(usersInWms, {
		fields: [importerClientInWms.createdBy],
		references: [usersInWms.id],
		relationName: "importerClientInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [importerClientInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "importerClientInWms_deletedBy_usersInWms_id"
	}),
	importerInWm: one(importerInWms, {
		fields: [importerClientInWms.importerId],
		references: [importerInWms.id]
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [importerClientInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "importerClientInWms_updatedBy_usersInWms_id"
	}),
	salesAgentClientInWms: many(salesAgentClientInWms),
}));

export const salesAgentClientInWmsRelations = relations(salesAgentClientInWms, ({one}) => ({
	usersInWm_agentUserId: one(usersInWms, {
		fields: [salesAgentClientInWms.agentUserId],
		references: [usersInWms.id],
		relationName: "salesAgentClientInWms_agentUserId_usersInWms_id"
	}),
	usersInWm_assignedBy: one(usersInWms, {
		fields: [salesAgentClientInWms.assignedBy],
		references: [usersInWms.id],
		relationName: "salesAgentClientInWms_assignedBy_usersInWms_id"
	}),
	importerClientInWm: one(importerClientInWms, {
		fields: [salesAgentClientInWms.clientId],
		references: [importerClientInWms.id]
	}),
	usersInWm_revokedBy: one(usersInWms, {
		fields: [salesAgentClientInWms.revokedBy],
		references: [usersInWms.id],
		relationName: "salesAgentClientInWms_revokedBy_usersInWms_id"
	}),
}));

export const transporterInWmsRelations = relations(transporterInWms, ({one, many}) => ({
	cityInWm: one(cityInWms, {
		fields: [transporterInWms.cityId],
		references: [cityInWms.id]
	}),
	usersInWm_createdBy: one(usersInWms, {
		fields: [transporterInWms.createdBy],
		references: [usersInWms.id],
		relationName: "transporterInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [transporterInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "transporterInWms_deletedBy_usersInWms_id"
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [transporterInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "transporterInWms_updatedBy_usersInWms_id"
	}),
	vehicleInWms: many(vehicleInWms),
	warehouseTransporterInWms: many(warehouseTransporterInWms),
}));

export const vehicleInWmsRelations = relations(vehicleInWms, ({one}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [vehicleInWms.createdBy],
		references: [usersInWms.id],
		relationName: "vehicleInWms_createdBy_usersInWms_id"
	}),
	usersInWm_deletedBy: one(usersInWms, {
		fields: [vehicleInWms.deletedBy],
		references: [usersInWms.id],
		relationName: "vehicleInWms_deletedBy_usersInWms_id"
	}),
	transporterInWm: one(transporterInWms, {
		fields: [vehicleInWms.transporterId],
		references: [transporterInWms.id]
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [vehicleInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "vehicleInWms_updatedBy_usersInWms_id"
	}),
	vehicleTypeInWm: one(vehicleTypeInWms, {
		fields: [vehicleInWms.vehicleTypeId],
		references: [vehicleTypeInWms.id]
	}),
}));

export const roleCreationRuleInWmsRelations = relations(roleCreationRuleInWms, ({one}) => ({
	roleInWm_actorRole: one(roleInWms, {
		fields: [roleCreationRuleInWms.actorRole],
		references: [roleInWms.key],
		relationName: "roleCreationRuleInWms_actorRole_roleInWms_key"
	}),
	roleInWm_targetRole: one(roleInWms, {
		fields: [roleCreationRuleInWms.targetRole],
		references: [roleInWms.key],
		relationName: "roleCreationRuleInWms_targetRole_roleInWms_key"
	}),
}));

export const roleInWmsRelations = relations(roleInWms, ({many}) => ({
	roleCreationRuleInWms_actorRole: many(roleCreationRuleInWms, {
		relationName: "roleCreationRuleInWms_actorRole_roleInWms_key"
	}),
	roleCreationRuleInWms_targetRole: many(roleCreationRuleInWms, {
		relationName: "roleCreationRuleInWms_targetRole_roleInWms_key"
	}),
	userRoleAssignmentInWms: many(userRoleAssignmentInWms),
	notificationRuleInWms: many(notificationRuleInWms),
	rolePermissionInWms: many(rolePermissionInWms),
}));

export const userRoleAssignmentInWmsRelations = relations(userRoleAssignmentInWms, ({one}) => ({
	usersInWm_assignedBy: one(usersInWms, {
		fields: [userRoleAssignmentInWms.assignedBy],
		references: [usersInWms.id],
		relationName: "userRoleAssignmentInWms_assignedBy_usersInWms_id"
	}),
	importerInWm: one(importerInWms, {
		fields: [userRoleAssignmentInWms.importerId],
		references: [importerInWms.id]
	}),
	usersInWm_revokedBy: one(usersInWms, {
		fields: [userRoleAssignmentInWms.revokedBy],
		references: [usersInWms.id],
		relationName: "userRoleAssignmentInWms_revokedBy_usersInWms_id"
	}),
	roleInWm: one(roleInWms, {
		fields: [userRoleAssignmentInWms.role],
		references: [roleInWms.key]
	}),
	usersInWm_userId: one(usersInWms, {
		fields: [userRoleAssignmentInWms.userId],
		references: [usersInWms.id],
		relationName: "userRoleAssignmentInWms_userId_usersInWms_id"
	}),
	warehouseInWm: one(warehouseInWms, {
		fields: [userRoleAssignmentInWms.warehouseId],
		references: [warehouseInWms.id]
	}),
}));

export const permissionOverrideInWmsRelations = relations(permissionOverrideInWms, ({one}) => ({
	usersInWm_grantedBy: one(usersInWms, {
		fields: [permissionOverrideInWms.grantedBy],
		references: [usersInWms.id],
		relationName: "permissionOverrideInWms_grantedBy_usersInWms_id"
	}),
	permissionInWm: one(permissionInWms, {
		fields: [permissionOverrideInWms.permission],
		references: [permissionInWms.key]
	}),
	usersInWm_userId: one(usersInWms, {
		fields: [permissionOverrideInWms.userId],
		references: [usersInWms.id],
		relationName: "permissionOverrideInWms_userId_usersInWms_id"
	}),
}));

export const permissionInWmsRelations = relations(permissionInWms, ({many}) => ({
	permissionOverrideInWms: many(permissionOverrideInWms),
	rolePermissionInWms: many(rolePermissionInWms),
}));

export const notificationTemplateInWmsRelations = relations(notificationTemplateInWms, ({one}) => ({
	usersInWm_createdBy: one(usersInWms, {
		fields: [notificationTemplateInWms.createdBy],
		references: [usersInWms.id],
		relationName: "notificationTemplateInWms_createdBy_usersInWms_id"
	}),
	notificationEventInWm: one(notificationEventInWms, {
		fields: [notificationTemplateInWms.eventKey],
		references: [notificationEventInWms.key]
	}),
	usersInWm_updatedBy: one(usersInWms, {
		fields: [notificationTemplateInWms.updatedBy],
		references: [usersInWms.id],
		relationName: "notificationTemplateInWms_updatedBy_usersInWms_id"
	}),
}));

export const notificationEventInWmsRelations = relations(notificationEventInWms, ({many}) => ({
	notificationTemplateInWms: many(notificationTemplateInWms),
	notificationInWms: many(notificationInWms),
	notificationRuleInWms: many(notificationRuleInWms),
	notificationPreferenceInWms: many(notificationPreferenceInWms),
}));

export const notificationInWmsRelations = relations(notificationInWms, ({one, many}) => ({
	usersInWm_actorUserId: one(usersInWms, {
		fields: [notificationInWms.actorUserId],
		references: [usersInWms.id],
		relationName: "notificationInWms_actorUserId_usersInWms_id"
	}),
	notificationEventInWm: one(notificationEventInWms, {
		fields: [notificationInWms.eventKey],
		references: [notificationEventInWms.key]
	}),
	importerInWm: one(importerInWms, {
		fields: [notificationInWms.importerId],
		references: [importerInWms.id]
	}),
	usersInWm_recipientUserId: one(usersInWms, {
		fields: [notificationInWms.recipientUserId],
		references: [usersInWms.id],
		relationName: "notificationInWms_recipientUserId_usersInWms_id"
	}),
	notificationRuleInWm: one(notificationRuleInWms, {
		fields: [notificationInWms.ruleId],
		references: [notificationRuleInWms.id]
	}),
	warehouseInWm: one(warehouseInWms, {
		fields: [notificationInWms.warehouseId],
		references: [warehouseInWms.id]
	}),
	notificationDeliveryInWms: many(notificationDeliveryInWms),
}));

export const notificationRuleInWmsRelations = relations(notificationRuleInWms, ({one, many}) => ({
	notificationInWms: many(notificationInWms),
	notificationEventInWm: one(notificationEventInWms, {
		fields: [notificationRuleInWms.eventKey],
		references: [notificationEventInWms.key]
	}),
	roleInWm: one(roleInWms, {
		fields: [notificationRuleInWms.roleFilter],
		references: [roleInWms.key]
	}),
}));

export const notificationQuietHoursInWmsRelations = relations(notificationQuietHoursInWms, ({one}) => ({
	usersInWm: one(usersInWms, {
		fields: [notificationQuietHoursInWms.userId],
		references: [usersInWms.id]
	}),
}));

export const notificationDeliveryInWmsRelations = relations(notificationDeliveryInWms, ({one}) => ({
	notificationInWm: one(notificationInWms, {
		fields: [notificationDeliveryInWms.notificationId],
		references: [notificationInWms.id]
	}),
}));

export const userDeviceInWmsRelations = relations(userDeviceInWms, ({one}) => ({
	usersInWm: one(usersInWms, {
		fields: [userDeviceInWms.userId],
		references: [usersInWms.id]
	}),
}));

export const rolePermissionInWmsRelations = relations(rolePermissionInWms, ({one}) => ({
	permissionInWm: one(permissionInWms, {
		fields: [rolePermissionInWms.permission],
		references: [permissionInWms.key]
	}),
	roleInWm: one(roleInWms, {
		fields: [rolePermissionInWms.role],
		references: [roleInWms.key]
	}),
}));

export const notificationPreferenceInWmsRelations = relations(notificationPreferenceInWms, ({one}) => ({
	notificationEventInWm: one(notificationEventInWms, {
		fields: [notificationPreferenceInWms.eventKey],
		references: [notificationEventInWms.key]
	}),
	usersInWm: one(usersInWms, {
		fields: [notificationPreferenceInWms.userId],
		references: [usersInWms.id]
	}),
}));

export const warehouseTransporterInWmsRelations = relations(warehouseTransporterInWms, ({one}) => ({
	usersInWm: one(usersInWms, {
		fields: [warehouseTransporterInWms.approvedBy],
		references: [usersInWms.id]
	}),
	transporterInWm: one(transporterInWms, {
		fields: [warehouseTransporterInWms.transporterId],
		references: [transporterInWms.id]
	}),
	warehouseInWm: one(warehouseInWms, {
		fields: [warehouseTransporterInWms.warehouseId],
		references: [warehouseInWms.id]
	}),
}));