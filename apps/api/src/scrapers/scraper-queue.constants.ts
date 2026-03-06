export const SCRAPER_QUEUE = "scraper";

export const ScraperJob = {
  BK_SYNC: "bk.sync",
} as const;

export type ScraperJobName = (typeof ScraperJob)[keyof typeof ScraperJob];
