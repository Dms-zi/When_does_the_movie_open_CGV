CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`movie_id` text NOT NULL,
	`play_date` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`claimed_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`token_hash`) REFERENCES `subscribers`(`token_hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_unique_date` ON `deliveries` (`token_hash`,`movie_id`,`play_date`);--> statement-breakpoint
CREATE INDEX `deliveries_pending` ON `deliveries` (`sent_at`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`dates` text NOT NULL,
	`bookable_dates` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seen_dates` (
	`movie_id` text NOT NULL,
	`play_date` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `play_date`)
);
--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscribers` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`subscription` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_endpoint_unique` ON `subscribers` (`endpoint`);--> statement-breakpoint
CREATE TABLE `watches` (
	`token_hash` text NOT NULL,
	`movie_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`token_hash`, `movie_id`),
	FOREIGN KEY (`token_hash`) REFERENCES `subscribers`(`token_hash`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `watches_movie` ON `watches` (`movie_id`);