import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateEnv } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { ScrapersModule } from "./scrapers/scrapers.module.js";
import { AnnouncementsModule } from "./announcements/announcements.module.js";
import { NormalizationModule } from "./normalization/normalization.module.js";
import { EmbeddingModule } from "./embedding/embedding.module.js";
import { SearchModule } from "./search/search.module.js";
import { ClientsModule } from "./clients/clients.module.js";
import { LogsModule } from "./logs/logs.module.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const envFilePaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../../.env"),
  resolve(currentDir, "../.env"),
  resolve(currentDir, "../../../.env"),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths,
      validate: validateEnv,
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    UsersModule,
    HealthModule,
    ScrapersModule,
    AnnouncementsModule,
    NormalizationModule,
    EmbeddingModule,
    SearchModule,
    ClientsModule,
    LogsModule,
  ],
})
export class AppModule {}
