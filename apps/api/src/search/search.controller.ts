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
    const results = await this.searchService.semanticSearch(
      query.q,
      query.limit,
      query.threshold,
    );

    return {
      data: results,
      meta: {
        query: query.q,
        limit: query.limit,
        count: results.length,
        threshold: query.threshold,
      },
    };
  }
}
