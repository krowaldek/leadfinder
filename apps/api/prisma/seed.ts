import { hash } from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, AccountType, SystemRole, UserStatus } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(currentDir, "../../../.env") });
loadEnv({ path: resolve(currentDir, "../.env"), override: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for seeding.");
}

const runtimeUrl = new URL(connectionString);
const schema = runtimeUrl.searchParams.get("schema") ?? "public";
runtimeUrl.searchParams.delete("schema");

const adapter = new PrismaPg({ connectionString: runtimeUrl.toString() }, { schema });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@leadfinder.local";
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await hash(password, 10);

  await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      passwordHash,
      firstName: "Leadfinder",
      lastName: "Admin",
      systemRole: SystemRole.SUPER_ADMIN,
      accountType: AccountType.PERSONAL,
      status: UserStatus.ACTIVE,
    },
    create: {
      email: email.toLowerCase(),
      passwordHash,
      firstName: "Leadfinder",
      lastName: "Admin",
      systemRole: SystemRole.SUPER_ADMIN,
      accountType: AccountType.PERSONAL,
      status: UserStatus.ACTIVE,
    },
  });

  console.log(`Seeded admin user: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
