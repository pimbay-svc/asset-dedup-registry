CREATE TABLE "algorithm" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe" varchar(64) NOT NULL,
	"comparison" varchar(16) NOT NULL,
	CONSTRAINT "algorithm_recipe_unique" UNIQUE("recipe"),
	CONSTRAINT "chk_algorithm_comparison" CHECK ("algorithm"."comparison" IN ('exact', 'hamming', 'cosine'))
);
--> statement-breakpoint
CREATE TABLE "api_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"scopes" text[] NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_client_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "asset_hash_duplicate" (
	"id" serial PRIMARY KEY NOT NULL,
	"algorithm_id" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	"other_asset_id" uuid NOT NULL,
	"distance" integer NOT NULL,
	"similarity" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_hash_duplicate_pair" UNIQUE("algorithm_id","asset_id","other_asset_id")
);
--> statement-breakpoint
CREATE TABLE "asset_hash" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"algorithm_id" integer NOT NULL,
	"sequence_index" integer DEFAULT 0 NOT NULL,
	"hash" varchar(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_asset_hash_asset_algorithm_sequence" UNIQUE("asset_id","algorithm_id","sequence_index")
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"identity_id" varchar(128),
	"identity_path" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_asset_identity_present" CHECK ("asset"."identity_id" IS NOT NULL OR "asset"."identity_path" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "cluster_cache_asset" (
	"asset_id" uuid NOT NULL,
	"cluster_cache_meta_id" integer NOT NULL,
	"cluster_id" uuid NOT NULL,
	CONSTRAINT "cluster_cache_asset_asset_id_cluster_cache_meta_id_pk" PRIMARY KEY("asset_id","cluster_cache_meta_id")
);
--> statement-breakpoint
CREATE TABLE "cluster_cache_meta" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"algorithm_id" integer NOT NULL,
	"threshold" double precision NOT NULL,
	"generation" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_cluster_cache_meta" UNIQUE("project_id","algorithm_id","threshold","generation")
);
--> statement-breakpoint
CREATE TABLE "cluster_generation" (
	"project_id" uuid NOT NULL,
	"algorithm_id" integer NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cluster_generation_project_id_algorithm_id_pk" PRIMARY KEY("project_id","algorithm_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"recipes" text[] NOT NULL,
	"hamming_threshold" numeric(5, 2),
	"rate_limit_per_minute" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "api_client" ADD CONSTRAINT "api_client_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_hash_duplicate" ADD CONSTRAINT "asset_hash_duplicate_algorithm_id_algorithm_id_fk" FOREIGN KEY ("algorithm_id") REFERENCES "public"."algorithm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_hash_duplicate" ADD CONSTRAINT "asset_hash_duplicate_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_hash_duplicate" ADD CONSTRAINT "asset_hash_duplicate_other_asset_id_asset_id_fk" FOREIGN KEY ("other_asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_hash" ADD CONSTRAINT "asset_hash_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_hash" ADD CONSTRAINT "asset_hash_algorithm_id_algorithm_id_fk" FOREIGN KEY ("algorithm_id") REFERENCES "public"."algorithm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_cache_asset" ADD CONSTRAINT "cluster_cache_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_cache_asset" ADD CONSTRAINT "cluster_cache_asset_meta_id_fk" FOREIGN KEY ("cluster_cache_meta_id") REFERENCES "public"."cluster_cache_meta"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_cache_meta" ADD CONSTRAINT "cluster_cache_meta_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_cache_meta" ADD CONSTRAINT "cluster_cache_meta_algorithm_id_algorithm_id_fk" FOREIGN KEY ("algorithm_id") REFERENCES "public"."algorithm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_generation" ADD CONSTRAINT "cluster_generation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_generation" ADD CONSTRAINT "cluster_generation_algorithm_id_algorithm_id_fk" FOREIGN KEY ("algorithm_id") REFERENCES "public"."algorithm"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_api_client_project_name_active" ON "api_client" USING btree ("project_id","name") WHERE "api_client"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_hash_duplicate_asset" ON "asset_hash_duplicate" USING btree ("algorithm_id","asset_id","similarity");--> statement-breakpoint
CREATE INDEX "idx_asset_hash_algorithm" ON "asset_hash" USING btree ("algorithm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_asset_project_identity_id" ON "asset" USING btree ("project_id","identity_id") WHERE "asset"."identity_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_asset_project_identity_path" ON "asset" USING btree ("project_id","identity_path") WHERE "asset"."identity_path" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cluster_cache_asset_cluster_cache_meta_id_lookup_fk" ON "cluster_cache_asset" USING btree ("cluster_cache_meta_id","cluster_id");--> statement-breakpoint
CREATE INDEX "idx_cluster_cache_meta_retention" ON "cluster_cache_meta" USING btree ("project_id","algorithm_id","computed_at");