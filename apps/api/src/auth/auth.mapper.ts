import { AuthUser } from "@leadfinder/contracts";
import { User } from "@prisma/client";

export function mapUserToAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    systemRole: user.systemRole,
    accountType: user.accountType,
    companyName: user.companyName,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
