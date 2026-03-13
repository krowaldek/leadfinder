export const SCRAPER_QUEUE = "scraper";

export const ScraperJob = {
  BK_SYNC: "bk.sync",
  EZ_SYNC: "ez.sync",
  PZ_SYNC: "pz.sync",
} as const;

export type ScraperJobName = (typeof ScraperJob)[keyof typeof ScraperJob];
