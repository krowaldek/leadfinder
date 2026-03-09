import { Controller, Get, Inject, Query, UseGuards, Logger } from "@nestjs/common";
import { JwtAuthGuard } from "../common/jwt-auth.guard.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SearchService } from "./search.service.js";
import { searchQuerySchema, type SearchQuery } from "@leadfinder/contracts";

@UseGuards(JwtAuthGuard)
@Controller("search")
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    @Inject(SearchService)
    private readonly searchService: SearchService,
  ) {}

  @Get()
  async search(
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ) {
    const result = await this.searchService.semanticSearch(
      query.q,
      query.limit,
      query.threshold,
      query.mode,
    );

    return {
      data: result.items,
      meta: {
        query: query.q,
        effectiveQuery: result.effectiveQuery,
        mode: query.mode,
        limit: query.limit,
        count: result.items.length,
        threshold: query.threshold,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
