-- Ward Environment Officers own the immutable daily attendance report for
-- their assigned ward. Respect role bundles that an operator has explicitly
-- customized through the permissions editor.
INSERT INTO "RoleCapability" ("roleId", "capabilityId")
SELECT role."id", capability."id"
FROM "Role" role
CROSS JOIN "Capability" capability
WHERE role."code" = 'WARD_OFFICER'
  AND role."permissionsManagedAt" IS NULL
  AND capability."code" = 'REPORTS_FINALIZE'
ON CONFLICT ("roleId", "capabilityId") DO NOTHING;
