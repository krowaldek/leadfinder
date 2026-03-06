import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createUserSchema,
  updateUserSchema,
  updateUserStatusSchema,
  usersListQuerySchema,
  AuthUser,
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
  UsersListQuery,
} from "@leadfinder/contracts";
import { UsersService } from "./users.service.js";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { RolesGuard } from "../common/roles.guard.js";
import { Roles } from "../common/roles.decorator.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { CurrentUser } from "../common/current-user.decorator.js";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("SUPER_ADMIN", "ADMIN")
@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private readonly usersService: UsersService) {}

  @Get()
  async findAll(@Query(new ZodValidationPipe(usersListQuerySchema)) query: UsersListQuery) {
    return this.usersService.findAll(query);
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return {
      data: await this.usersService.findOne(id),
    };
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      data: await this.usersService.create(body, user),
    };
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      data: await this.usersService.update(id, body, user),
    };
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateUserStatusSchema)) body: UpdateUserStatusInput,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      data: await this.usersService.updateStatus(id, body, user),
    };
  }
}
