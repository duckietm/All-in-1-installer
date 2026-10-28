CREATE TABLE `achievements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL DEFAULT 'ACH_',
	`category` varchar(12) NOT NULL DEFAULT 'identity',
	`level` int NOT NULL DEFAULT 1,
	`reward_amount` int NOT NULL DEFAULT 100,
	`reward_type` int NOT NULL DEFAULT 0,
	`points` int DEFAULT 10,
	`progress_needed` int NOT NULL DEFAULT 1,
	CONSTRAINT `achievements_name_level_pk` PRIMARY KEY(`name`,`level`),
	CONSTRAINT `achievements_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `achievements_talents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(11) NOT NULL DEFAULT 'citizenship',
	`level` int NOT NULL DEFAULT 0,
	`achievement_ids` varchar(100) NOT NULL DEFAULT '',
	`achievement_levels` varchar(100) NOT NULL DEFAULT '',
	`reward_furni` varchar(100) NOT NULL DEFAULT '',
	`reward_perks` varchar(100) NOT NULL DEFAULT '',
	`reward_badges` varchar(100) NOT NULL DEFAULT '',
	CONSTRAINT `achievements_talents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `acl_model_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`model_type` varchar(191) NOT NULL DEFAULT 'Role',
	`model_id` int NOT NULL,
	`permission_id` int NOT NULL,
	CONSTRAINT `acl_model_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `acl_model_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`model_type` varchar(191) NOT NULL DEFAULT 'User',
	`model_id` int NOT NULL,
	`role_id` int NOT NULL,
	CONSTRAINT `acl_model_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `acl_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT '',
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime,
	CONSTRAINT `acl_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `acl_permissions_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `acl_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT '',
	`description` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime,
	CONSTRAINT `acl_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `acl_roles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`action` varchar(191) NOT NULL DEFAULT '',
	`target` varchar(191) NOT NULL DEFAULT '',
	`target_id` int,
	`details` text,
	`before` text,
	`after` text,
	`diff` text,
	`ip_address` varchar(45),
	`created_at` varchar(64) NOT NULL DEFAULT '',
	`updated_at` varchar(64),
	CONSTRAINT `admin_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alert_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`type` varchar(255) NOT NULL,
	`severity` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`context` longtext,
	`sent_via_email` boolean NOT NULL DEFAULT false,
	`sent_via_discord` boolean NOT NULL DEFAULT false,
	`is_read` boolean NOT NULL DEFAULT false,
	`read_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `alert_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`ip` varchar(50) NOT NULL DEFAULT '',
	`machine_id` varchar(255) NOT NULL DEFAULT '',
	`user_staff_id` int NOT NULL,
	`timestamp` int NOT NULL,
	`ban_expire` int NOT NULL DEFAULT 0,
	`ban_reason` varchar(200) NOT NULL DEFAULT '',
	`type` enum('account','ip','machine','super') NOT NULL DEFAULT 'account',
	`cfh_topic` int NOT NULL DEFAULT -1,
	CONSTRAINT `bans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`room_id` int NOT NULL DEFAULT 0,
	`name` varchar(25) NOT NULL DEFAULT '',
	`motto` varchar(100) NOT NULL DEFAULT '',
	`figure` varchar(500) NOT NULL DEFAULT '',
	`gender` varchar(1) NOT NULL DEFAULT 'M',
	`x` int NOT NULL DEFAULT 0,
	`y` int NOT NULL DEFAULT 0,
	`z` double NOT NULL DEFAULT 0,
	`rot` int NOT NULL DEFAULT 0,
	`chat_lines` varchar(5112) NOT NULL DEFAULT '',
	`chat_auto` varchar(1) NOT NULL DEFAULT '1',
	`chat_random` varchar(1) NOT NULL DEFAULT '1',
	`chat_delay` int NOT NULL DEFAULT 5,
	`dance` int NOT NULL DEFAULT 0,
	`freeroam` varchar(1) NOT NULL DEFAULT '0',
	`type` varchar(32) NOT NULL DEFAULT 'generic',
	`effect` int NOT NULL DEFAULT 0,
	`bubble_id` int DEFAULT 31,
	CONSTRAINT `bots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT '',
	`image` varchar(255) NOT NULL DEFAULT '',
	`start_timestamp` int NOT NULL DEFAULT 0,
	`total_days` int NOT NULL DEFAULT 30,
	`lock_expired` varchar(1) NOT NULL DEFAULT '1',
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	CONSTRAINT `calendar_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `calendar_rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL DEFAULT 0,
	`product_name` varchar(128) NOT NULL DEFAULT '',
	`custom_image` varchar(128) NOT NULL DEFAULT '',
	`credits` int NOT NULL DEFAULT 0,
	`pixels` int NOT NULL DEFAULT 0,
	`points` int NOT NULL DEFAULT 0,
	`points_type` int NOT NULL DEFAULT 0,
	`badge` varchar(25) NOT NULL DEFAULT '',
	`item_id` int NOT NULL DEFAULT 0,
	`subscription_type` varchar(128) DEFAULT '',
	`subscription_days` int NOT NULL DEFAULT 0,
	CONSTRAINT `calendar_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `camera_web` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`room_id` int NOT NULL DEFAULT 0,
	`timestamp` int NOT NULL,
	`url` varchar(128) NOT NULL DEFAULT '',
	CONSTRAINT `camera_web_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_clothing` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(75) NOT NULL,
	`setid` varchar(200) NOT NULL,
	CONSTRAINT `catalog_clothing_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_club_offers` (
	`id` int NOT NULL,
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	`name` varchar(35) NOT NULL,
	`days` int NOT NULL,
	`credits` int NOT NULL DEFAULT 10,
	`points` int NOT NULL DEFAULT 0,
	`points_type` int NOT NULL DEFAULT 0,
	`type` varchar(19) NOT NULL DEFAULT 'HC',
	`deal` varchar(1) NOT NULL DEFAULT '0',
	`giftable` varchar(1) NOT NULL DEFAULT '0',
	CONSTRAINT `catalog_club_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_featured_pages` (
	`slot_id` int NOT NULL,
	`image` varchar(70) NOT NULL DEFAULT '',
	`caption` varchar(130) NOT NULL DEFAULT '',
	`type` varchar(12) NOT NULL DEFAULT 'page_name',
	`expire_timestamp` int NOT NULL DEFAULT -1,
	`page_name` varchar(30) NOT NULL DEFAULT '',
	`page_id` int NOT NULL DEFAULT 0,
	`product_name` varchar(40) NOT NULL DEFAULT '',
	CONSTRAINT `catalog_featured_pages_slot_id` PRIMARY KEY(`slot_id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_ids` varchar(666) NOT NULL,
	`page_id` int NOT NULL,
	`catalog_name` varchar(100) NOT NULL,
	`cost_credits` int NOT NULL DEFAULT 3,
	`cost_points` int NOT NULL DEFAULT 0,
	`points_type` int NOT NULL DEFAULT 0,
	`amount` int NOT NULL DEFAULT 1,
	`limited_stack` int NOT NULL DEFAULT 0,
	`limited_sells` int NOT NULL DEFAULT 0,
	`order_number` int NOT NULL DEFAULT 1,
	`offer_id` int NOT NULL DEFAULT -1,
	`song_id` int unsigned NOT NULL DEFAULT 0,
	`extradata` varchar(500) NOT NULL DEFAULT '',
	`haveOffer` varchar(255) NOT NULL DEFAULT '1',
	`club_only` varchar(1) NOT NULL DEFAULT '0',
	CONSTRAINT `catalog_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_items_bc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_ids` varchar(666) NOT NULL,
	`page_id` int NOT NULL,
	`catalog_name` varchar(100) NOT NULL,
	`order_number` int NOT NULL DEFAULT 1,
	`extradata` varchar(500) NOT NULL DEFAULT '',
	CONSTRAINT `catalog_items_bc_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_items_limited` (
	`catalog_item_id` int NOT NULL,
	`number` int NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`timestamp` int NOT NULL DEFAULT 0,
	`item_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `catalog_items_limited_catalogItemId_number` UNIQUE(`catalog_item_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `catalog_pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL DEFAULT -1,
	`caption_save` varchar(25) NOT NULL DEFAULT '',
	`caption` varchar(128) NOT NULL,
	`page_layout` varchar(26) NOT NULL DEFAULT 'default_3x3',
	`icon_color` int NOT NULL DEFAULT 1,
	`icon_image` int NOT NULL DEFAULT 1,
	`min_rank` int NOT NULL DEFAULT 1,
	`order_num` int NOT NULL DEFAULT 1,
	`visible` varchar(1) NOT NULL DEFAULT '1',
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	`club_only` varchar(1) NOT NULL DEFAULT '0',
	`vip_only` varchar(1) NOT NULL DEFAULT '0',
	`page_headline` varchar(1024) NOT NULL DEFAULT '',
	`page_teaser` varchar(64) NOT NULL DEFAULT '',
	`page_special` varchar(2048),
	`page_text1` text,
	`page_text2` text,
	`page_text_details` text,
	`page_text_teaser` text,
	`room_id` int DEFAULT 0,
	`includes` varchar(128) NOT NULL DEFAULT '',
	CONSTRAINT `catalog_pages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_pages_bc` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL DEFAULT -1,
	`caption` varchar(128) NOT NULL,
	`page_layout` varchar(26) NOT NULL DEFAULT 'default_3x3',
	`icon_color` int NOT NULL DEFAULT 1,
	`icon_image` int NOT NULL DEFAULT 1,
	`order_num` int NOT NULL DEFAULT 1,
	`visible` varchar(1) NOT NULL DEFAULT '1',
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	`page_headline` varchar(1024) NOT NULL DEFAULT '',
	`page_teaser` varchar(64) NOT NULL DEFAULT '',
	`page_special` varchar(2048),
	`page_text1` text,
	`page_text2` text,
	`page_text_details` text,
	`page_text_teaser` text,
	CONSTRAINT `catalog_pages_bc_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_target_offers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`offer_code` varchar(32) NOT NULL,
	`title` varchar(128) NOT NULL DEFAULT '',
	`description` varchar(2048) NOT NULL DEFAULT '',
	`image` varchar(128) NOT NULL,
	`icon` varchar(128) NOT NULL,
	`end_timestamp` int NOT NULL,
	`credits` int NOT NULL DEFAULT 10,
	`points` int NOT NULL DEFAULT 10,
	`points_type` int NOT NULL DEFAULT 5,
	`purchase_limit` int NOT NULL DEFAULT 5,
	`catalog_item` int NOT NULL,
	`vars` varchar(1024) NOT NULL DEFAULT '',
	CONSTRAINT `catalog_target_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chatlogs_private` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_from_id` int NOT NULL,
	`user_to_id` int NOT NULL,
	`message` varchar(255) NOT NULL,
	`timestamp` int NOT NULL DEFAULT 0,
	CONSTRAINT `chatlogs_private_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `claimed_referral_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`ip_address` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `claimed_referral_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crafting_altars_recipes` (
	`altar_id` int NOT NULL,
	`recipe_id` int NOT NULL,
	CONSTRAINT `crafting_altars_recipes_altarId_recipeId` UNIQUE(`altar_id`,`recipe_id`)
);
--> statement-breakpoint
CREATE TABLE `crafting_recipes` (
	`id` int NOT NULL,
	`product_name` varchar(64) NOT NULL,
	`reward` int NOT NULL,
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	`achievement` varchar(255) NOT NULL DEFAULT '',
	`secret` varchar(1) NOT NULL DEFAULT '0',
	`limited` varchar(1) NOT NULL DEFAULT '0',
	`remaining` int NOT NULL DEFAULT 0,
	CONSTRAINT `crafting_recipes_id` PRIMARY KEY(`id`),
	CONSTRAINT `crafting_recipes_product_name_unique` UNIQUE(`product_name`),
	CONSTRAINT `crafting_recipes_productName` UNIQUE(`product_name`)
);
--> statement-breakpoint
CREATE TABLE `daily_challenges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255) NOT NULL,
	`game` varchar(255),
	`type` varchar(255) NOT NULL,
	`target` int NOT NULL,
	`reward_currency` varchar(255) NOT NULL DEFAULT 'credits',
	`reward_amount` int NOT NULL,
	`date` date NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `daily_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`variables` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_templates_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `emulator_errors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timestamp` int NOT NULL DEFAULT 0,
	`version` varchar(64) NOT NULL,
	`build_hash` varchar(64) NOT NULL,
	`type` varchar(32) NOT NULL DEFAULT 'Exception',
	`stacktrace` binary NOT NULL,
	CONSTRAINT `emulator_errors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emulator_settings` (
	`key` varchar(100) NOT NULL,
	`value` varchar(512) NOT NULL,
	CONSTRAINT `emulator_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `emulator_texts` (
	`key` varchar(100) NOT NULL,
	`value` varchar(4096) NOT NULL,
	CONSTRAINT `emulator_texts_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `game_chat_messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`room_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`message` text NOT NULL,
	`type` varchar(255) NOT NULL DEFAULT 'chat',
	`reactions` longtext,
	`created_at` timestamp NOT NULL,
	CONSTRAINT `game_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_invitations` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`from_user_id` bigint unsigned NOT NULL,
	`to_user_id` bigint unsigned NOT NULL,
	`game` varchar(255) NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'pending',
	`bet_amount` int NOT NULL DEFAULT 0,
	`bet_currency` varchar(255) NOT NULL DEFAULT 'credits',
	`room_id` bigint unsigned,
	`expires_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_invitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_level_rewards` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`game` varchar(255) NOT NULL,
	`level` int NOT NULL,
	`reward_type` varchar(255) NOT NULL,
	`reward_currency` varchar(255),
	`reward_amount` int NOT NULL DEFAULT 0,
	`claimed` boolean NOT NULL DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_level_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_ranks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`icon` varchar(255) NOT NULL DEFAULT '⭐',
	`color` varchar(255) NOT NULL DEFAULT '#ffffff',
	`min_points` int NOT NULL DEFAULT 0,
	`max_points` int,
	`tier` int NOT NULL DEFAULT 1,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_ranks_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_ranks_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `game_replays` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`game` varchar(255) NOT NULL,
	`player1_id` bigint unsigned NOT NULL,
	`player2_id` bigint unsigned,
	`game_data` longtext NOT NULL,
	`moves` longtext NOT NULL,
	`winner` varchar(255),
	`player1_score` int NOT NULL DEFAULT 0,
	`player2_score` int NOT NULL DEFAULT 0,
	`started_at` timestamp NOT NULL,
	`ended_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_replays_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_reward_claims` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`game` varchar(50) NOT NULL,
	`wins_required` int NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_reward_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_reward_claims_userId_game_winsRequired` UNIQUE(`user_id`,`game`,`wins_required`)
);
--> statement-breakpoint
CREATE TABLE `game_rooms` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`game` varchar(50) NOT NULL,
	`player1_id` int unsigned NOT NULL,
	`player2_id` int unsigned,
	`state` longtext,
	`turn` int unsigned NOT NULL DEFAULT 1,
	`winner_id` int unsigned,
	`status` varchar(8) NOT NULL DEFAULT 'waiting',
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_rooms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_scores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`game` varchar(50) NOT NULL,
	`score` int NOT NULL DEFAULT 0,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `game_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gift_wrappers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sprite_id` int NOT NULL,
	`item_id` int NOT NULL,
	`type` varchar(7) NOT NULL DEFAULT 'wrapper',
	CONSTRAINT `gift_wrappers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `groups_items` (
	`type` varchar(6) NOT NULL,
	`id` int NOT NULL,
	`firstvalue` varchar(255) NOT NULL,
	`secondvalue` varchar(2000) NOT NULL,
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	CONSTRAINT `groups_items_id_type_pk` PRIMARY KEY(`id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `guild_forum_views` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`guild_id` int NOT NULL,
	`timestamp` int NOT NULL,
	CONSTRAINT `guild_forum_views_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guilds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`name` varchar(50) NOT NULL DEFAULT '',
	`description` varchar(250) NOT NULL DEFAULT '',
	`room_id` int NOT NULL DEFAULT 0,
	`state` int NOT NULL DEFAULT 0,
	`rights` varchar(1) NOT NULL DEFAULT '0',
	`color_one` int NOT NULL DEFAULT 0,
	`color_two` int NOT NULL DEFAULT 0,
	`badge` varchar(256) NOT NULL DEFAULT '',
	`date_created` int NOT NULL,
	`forum` varchar(1) NOT NULL DEFAULT '0',
	`read_forum` varchar(8) NOT NULL DEFAULT 'EVERYONE',
	`post_messages` varchar(8) NOT NULL DEFAULT 'EVERYONE',
	`post_threads` varchar(8) NOT NULL DEFAULT 'EVERYONE',
	`mod_forum` varchar(6) NOT NULL DEFAULT 'ADMINS',
	CONSTRAINT `guilds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guilds_elements` (
	`id` int NOT NULL,
	`firstvalue` varchar(300) NOT NULL,
	`secondvalue` varchar(300) NOT NULL,
	`type` varchar(50) NOT NULL,
	`enabled` varchar(1) NOT NULL DEFAULT '1',
	CONSTRAINT `guilds_elements_id_type` UNIQUE(`id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `guilds_forums_comments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`thread_id` int unsigned NOT NULL DEFAULT 0,
	`user_id` int NOT NULL DEFAULT 0,
	`message` text NOT NULL,
	`created_at` int NOT NULL DEFAULT 0,
	`state` int NOT NULL DEFAULT 0,
	`admin_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `guilds_forums_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guilds_forums_threads` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`guild_id` int DEFAULT 0,
	`opener_id` int DEFAULT 0,
	`subject` varchar(255) DEFAULT '',
	`posts_count` int DEFAULT 0,
	`created_at` int DEFAULT 0,
	`updated_at` int DEFAULT 0,
	`state` int DEFAULT 0,
	`pinned` tinyint DEFAULT 0,
	`locked` tinyint DEFAULT 0,
	`admin_id` int DEFAULT 0,
	CONSTRAINT `guilds_forums_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guilds_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` int NOT NULL DEFAULT 0,
	`user_id` int NOT NULL DEFAULT 0,
	`level_id` int NOT NULL DEFAULT 0,
	`member_since` int NOT NULL DEFAULT 0,
	CONSTRAINT `guilds_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hotelview_news` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(100) NOT NULL,
	`text` varchar(500) NOT NULL,
	`button_text` varchar(50) NOT NULL,
	`button_type` varchar(6) NOT NULL DEFAULT 'web',
	`button_link` varchar(200) NOT NULL,
	`image` varchar(200) NOT NULL,
	CONSTRAINT `hotelview_news_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`room_id` int NOT NULL DEFAULT 0,
	`item_id` int unsigned DEFAULT 0,
	`wall_pos` varchar(20) NOT NULL DEFAULT '',
	`x` int NOT NULL DEFAULT 0,
	`y` int NOT NULL DEFAULT 0,
	`z` double NOT NULL DEFAULT 0,
	`rot` int NOT NULL DEFAULT 0,
	`extra_data` varchar(1024) NOT NULL DEFAULT '',
	`wired_data` varchar(10000) NOT NULL DEFAULT '',
	`limited_data` varchar(10) NOT NULL DEFAULT '0:0',
	`guild_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items_base` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`sprite_id` int NOT NULL DEFAULT 0,
	`public_name` varchar(56) NOT NULL DEFAULT '',
	`item_name` varchar(70) NOT NULL,
	`type` varchar(3) NOT NULL DEFAULT 's',
	`width` int NOT NULL DEFAULT 1,
	`length` int NOT NULL DEFAULT 1,
	`stack_height` double NOT NULL DEFAULT 0,
	`allow_stack` tinyint NOT NULL DEFAULT 1,
	`allow_sit` tinyint NOT NULL DEFAULT 0,
	`allow_lay` tinyint NOT NULL DEFAULT 0,
	`allow_walk` tinyint NOT NULL DEFAULT 0,
	`allow_gift` tinyint NOT NULL DEFAULT 1,
	`allow_trade` tinyint NOT NULL DEFAULT 1,
	`allow_recycle` tinyint NOT NULL DEFAULT 0,
	`allow_marketplace_sell` tinyint NOT NULL DEFAULT 0,
	`allow_inventory_stack` tinyint NOT NULL DEFAULT 1,
	`interaction_type` varchar(500) NOT NULL DEFAULT 'default',
	`interaction_modes_count` int NOT NULL DEFAULT 1,
	`vending_ids` varchar(255) NOT NULL DEFAULT '0',
	`multiheight` varchar(50) NOT NULL DEFAULT '0',
	`customparams` varchar(25600) NOT NULL DEFAULT '',
	`effect_id_male` int NOT NULL DEFAULT 0,
	`effect_id_female` int NOT NULL DEFAULT 0,
	`clothing_on_walk` varchar(255) NOT NULL DEFAULT '',
	CONSTRAINT `items_base_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items_crackable` (
	`item_id` int NOT NULL,
	`item_name` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`prizes` varchar(860) NOT NULL DEFAULT '179:1',
	`achievement_tick` varchar(64) NOT NULL,
	`achievement_cracked` varchar(64) NOT NULL,
	`required_effect` int NOT NULL DEFAULT 0,
	`subscription_duration` int,
	`subscription_type` varchar(255),
	CONSTRAINT `items_crackable_item_id` PRIMARY KEY(`item_id`)
);
--> statement-breakpoint
CREATE TABLE `items_highscore_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`user_ids` varchar(500) NOT NULL,
	`score` int NOT NULL,
	`is_win` tinyint DEFAULT 0,
	`timestamp` int NOT NULL,
	CONSTRAINT `items_highscore_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `logs_furni_imports` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`timestamp` int unsigned NOT NULL,
	`user_id` int NOT NULL,
	`batch` tinyint NOT NULL DEFAULT 0,
	`total_items` int NOT NULL DEFAULT 0,
	`succeeded` int NOT NULL DEFAULT 0,
	`failed` int NOT NULL DEFAULT 0,
	`details` text NOT NULL,
	`rolled_back` tinyint NOT NULL DEFAULT 0,
	`rolled_back_at` int unsigned,
	`rolled_back_by` int,
	CONSTRAINT `logs_furni_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `logs_hc_payday` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`timestamp` int unsigned,
	`user_id` int,
	`hc_streak` int unsigned,
	`total_coins_spent` int unsigned,
	`reward_coins_spent` int unsigned,
	`reward_streak` int unsigned,
	`total_payout` int unsigned,
	`currency` varchar(255),
	`claimed` tinyint DEFAULT 0,
	CONSTRAINT `logs_hc_payday_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `logs_shop_purchases` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`timestamp` int unsigned,
	`user_id` int,
	`catalog_item_id` int unsigned,
	`item_ids` text,
	`catalog_name` varchar(255),
	`cost_credits` int,
	`cost_points` int,
	`points_type` int,
	`amount` int,
	CONSTRAINT `logs_shop_purchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketplace_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`user_id` int NOT NULL,
	`price` int NOT NULL,
	`timestamp` int NOT NULL,
	`sold_timestamp` int NOT NULL DEFAULT 0,
	`state` int NOT NULL DEFAULT 1,
	CONSTRAINT `marketplace_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messenger_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(25) NOT NULL,
	`user_id` int NOT NULL,
	CONSTRAINT `messenger_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messenger_friendrequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_to_id` int NOT NULL DEFAULT 0,
	`user_from_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `messenger_friendrequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messenger_friendships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_one_id` int NOT NULL DEFAULT 0,
	`user_two_id` int NOT NULL DEFAULT 0,
	`relation` int NOT NULL DEFAULT 0,
	`friends_since` int NOT NULL DEFAULT 0,
	`category` int NOT NULL DEFAULT 0,
	CONSTRAINT `messenger_friendships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messenger_offline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`user_from_id` int NOT NULL DEFAULT 0,
	`message` varchar(500) NOT NULL,
	`sended_on` int NOT NULL,
	CONSTRAINT `messenger_offline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `navigator_filter` (
	`key` varchar(11) NOT NULL,
	`field` varchar(32) NOT NULL,
	`compare` varchar(18) NOT NULL,
	`database_query` varchar(1024) NOT NULL,
	CONSTRAINT `navigator_filter_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `navigator_flatcats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`min_rank` int NOT NULL DEFAULT 0,
	`caption_save` varchar(32) NOT NULL DEFAULT 'caption_save',
	`caption` varchar(100) NOT NULL,
	`canTrade` varchar(255) NOT NULL DEFAULT '1',
	`max_user_count` int NOT NULL DEFAULT 100,
	`public` varchar(1) NOT NULL DEFAULT '0',
	`list_type` int NOT NULL DEFAULT 0,
	`order_num` int NOT NULL DEFAULT 0,
	CONSTRAINT `navigator_flatcats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `navigator_publiccats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(32) NOT NULL DEFAULT 'Staff Picks',
	`image` varchar(1) NOT NULL DEFAULT '0',
	`visible` varchar(1) NOT NULL DEFAULT '1',
	`order_num` int NOT NULL DEFAULT 0,
	CONSTRAINT `navigator_publiccats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nux_gifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(4) NOT NULL DEFAULT 'item',
	`value` varchar(32) NOT NULL,
	`image` varchar(256) NOT NULL,
	CONSTRAINT `nux_gifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `old_guilds_forums` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` int NOT NULL,
	`user_id` int NOT NULL,
	`subject` mediumtext NOT NULL,
	`message` longtext NOT NULL,
	`state` varchar(15) NOT NULL DEFAULT 'OPEN',
	`admin_id` int NOT NULL DEFAULT 0,
	`pinned` varchar(1) NOT NULL DEFAULT '0',
	`locked` varchar(1) NOT NULL DEFAULT '0',
	`timestamp` int NOT NULL,
	CONSTRAINT `old_guilds_forums_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `old_guilds_forums_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`thread_id` int NOT NULL,
	`user_id` int NOT NULL,
	`timestamp` int NOT NULL,
	`message` longtext NOT NULL,
	`state` varchar(15) NOT NULL DEFAULT 'OPEN',
	`admin_id` int NOT NULL DEFAULT 0,
	CONSTRAINT `old_guilds_forums_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`email` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp,
	CONSTRAINT `password_resets_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `personal_access_tokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`tokenable_id` bigint unsigned NOT NULL,
	`tokenable_type` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`token` varchar(64) NOT NULL,
	`abilities` text,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `personal_access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_access_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `pet_actions` (
	`ID` int AUTO_INCREMENT NOT NULL,
	`pet_type` int NOT NULL,
	`pet_name` varchar(32) NOT NULL,
	`offspring_type` int NOT NULL DEFAULT -1,
	`happy_actions` varchar(100) NOT NULL DEFAULT '',
	`tired_actions` varchar(100) NOT NULL DEFAULT '',
	`random_actions` varchar(100) NOT NULL DEFAULT '',
	`can_swim` varchar(1) DEFAULT '0',
	CONSTRAINT `pet_actions_ID` PRIMARY KEY(`ID`)
);
--> statement-breakpoint
CREATE TABLE `pet_breeds` (
	`race` int NOT NULL,
	`color_one` int NOT NULL,
	`color_two` int NOT NULL,
	`has_color_one` varchar(1) NOT NULL DEFAULT '0',
	`has_color_two` varchar(1) NOT NULL DEFAULT '0',
	CONSTRAINT `pet_breeds_race_colorOne_colorTwo_hasColorOne_hasColorTwo` UNIQUE(`race`,`color_one`,`color_two`,`has_color_one`,`has_color_two`)
);
--> statement-breakpoint
CREATE TABLE `pet_commands_data` (
	`command_id` int NOT NULL,
	`text` varchar(15) NOT NULL,
	`required_level` int NOT NULL,
	`reward_xp` int NOT NULL DEFAULT 5,
	`cost_happyness` int NOT NULL DEFAULT 0,
	`cost_energy` int NOT NULL DEFAULT 0,
	CONSTRAINT `pet_commands_data_command_id` PRIMARY KEY(`command_id`)
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT 'Hey! We''d appreciate it if you could take some time to answer these questions. It will help improve our hotel.',
	`thanks_message` varchar(255) NOT NULL,
	`reward_badge` varchar(10) NOT NULL DEFAULT '',
	CONSTRAINT `polls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `polls_answers` (
	`poll_id` int NOT NULL,
	`user_id` int NOT NULL,
	`question_id` int NOT NULL,
	`answer` varchar(255) NOT NULL,
	CONSTRAINT `polls_answers_pollId_userId_questionId` UNIQUE(`poll_id`,`user_id`,`question_id`)
);
--> statement-breakpoint
CREATE TABLE `polls_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL DEFAULT 0,
	`poll_id` int NOT NULL,
	`order` int NOT NULL,
	`question` varchar(255) NOT NULL,
	`type` int NOT NULL DEFAULT 2,
	`min_selections` int NOT NULL DEFAULT 1,
	`options` varchar(255) NOT NULL,
	CONSTRAINT `polls_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_api_keys` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`key` varchar(64) NOT NULL,
	`allowed_ips` varchar(255),
	`permissions` longtext,
	`rate_limit` int NOT NULL DEFAULT 300,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `radio_api_keys_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `radio_applications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`real_name` varchar(255) NOT NULL,
	`age` int NOT NULL,
	`availability` text NOT NULL,
	`experience` text,
	`motivation` text NOT NULL,
	`music_style` text,
	`discord_username` varchar(255),
	`rank_id` bigint unsigned,
	`status` varchar(8) NOT NULL DEFAULT 'pending',
	`approved_by` bigint unsigned,
	`approved_at` timestamp,
	`rejected_by` bigint unsigned,
	`rejected_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_auto_dj_playlist` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`artist` varchar(255),
	`album` varchar(255),
	`artwork_url` varchar(255),
	`duration` int unsigned,
	`play_count` int unsigned NOT NULL DEFAULT 0,
	`last_played_at` timestamp,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_auto_dj_playlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_banners` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`image_path` varchar(255) NOT NULL,
	`title` varchar(255),
	`description` text,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_banners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_contests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`prize` varchar(255),
	`start_date` timestamp,
	`end_date` timestamp,
	`winner_id` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` bigint unsigned,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_contests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_giveaways` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`prize` varchar(255),
	`prize_amount` int NOT NULL DEFAULT 0,
	`prize_currency` varchar(50),
	`start_date` timestamp,
	`end_date` timestamp,
	`winner_id` bigint unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` bigint unsigned,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_giveaways_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_history` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`show_name` varchar(255),
	`started_at` timestamp NOT NULL,
	`ended_at` timestamp,
	`listeners_count` int NOT NULL DEFAULT 0,
	`notes` text,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_listener_points` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`points` decimal(10,2) NOT NULL DEFAULT 0,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_listener_points_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_ranks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255),
	`badge_code` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_ranks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_schedules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`day` varchar(255) NOT NULL,
	`start_time` time NOT NULL,
	`end_time` time NOT NULL,
	`show_name` varchar(255),
	`description` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_shouts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`message` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_shouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_song_plays` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`artist` varchar(255),
	`album` varchar(255),
	`artwork_url` varchar(255),
	`duration` int unsigned,
	`played_at` timestamp NOT NULL,
	`dj_id` bigint unsigned,
	`metadata` longtext,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_song_plays_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_song_requests` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned,
	`song_title` varchar(255),
	`artist` varchar(255),
	`is_approved` boolean NOT NULL DEFAULT false,
	`is_played` boolean NOT NULL DEFAULT false,
	`votes` int NOT NULL DEFAULT 0,
	`submitted_at` timestamp,
	`played_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_song_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `radio_song_votes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `radio_song_votes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`referred_user_id` bigint unsigned NOT NULL,
	`referred_user_ip` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_models` (
	`name` varchar(100) NOT NULL,
	`door_x` int NOT NULL,
	`door_y` int NOT NULL,
	`door_dir` int NOT NULL DEFAULT 2,
	`heightmap` text NOT NULL,
	`public_items` text NOT NULL,
	`club_only` varchar(1) NOT NULL DEFAULT '0',
	CONSTRAINT `room_models_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `room_trade_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_one_id` int NOT NULL,
	`user_two_id` int NOT NULL,
	`user_one_ip` varchar(45) NOT NULL,
	`user_two_ip` varchar(45) NOT NULL,
	`timestamp` int NOT NULL,
	`user_one_item_count` int NOT NULL,
	`user_two_item_count` int NOT NULL,
	CONSTRAINT `room_trade_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_trade_log_items` (
	`id` int NOT NULL,
	`item_id` int NOT NULL,
	`user_id` int NOT NULL,
	CONSTRAINT `room_trade_log_items_id_itemId_userId` UNIQUE(`id`,`item_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `room_wordfilter` (
	`room_id` int NOT NULL,
	`word` varchar(25) NOT NULL,
	CONSTRAINT `room_wordfilter_roomId_word` UNIQUE(`room_id`,`word`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_id` int NOT NULL DEFAULT 0,
	`owner_name` varchar(25) NOT NULL DEFAULT '',
	`name` varchar(50) NOT NULL DEFAULT '',
	`description` varchar(512) NOT NULL DEFAULT '',
	`model` varchar(20) NOT NULL DEFAULT 'model_a',
	`password` varchar(20) NOT NULL DEFAULT '',
	`state` varchar(9) NOT NULL DEFAULT 'open',
	`users` int NOT NULL DEFAULT 0,
	`users_max` int NOT NULL DEFAULT 25,
	`guild_id` int NOT NULL DEFAULT 0,
	`category` int NOT NULL DEFAULT 1,
	`score` int NOT NULL DEFAULT 0,
	`paper_floor` varchar(50) NOT NULL DEFAULT '0.0',
	`paper_wall` varchar(50) NOT NULL DEFAULT '0.0',
	`paper_landscape` varchar(50) NOT NULL DEFAULT '0.0',
	`thickness_wall` int NOT NULL DEFAULT 0,
	`wall_height` int NOT NULL DEFAULT -1,
	`thickness_floor` int NOT NULL DEFAULT 0,
	`moodlight_data` varchar(254) NOT NULL DEFAULT '2,1,1,#000000,255;2,3,1,#000000,255;2,3,1,#000000,255;',
	`tags` varchar(500) NOT NULL DEFAULT '',
	`is_public` varchar(1) NOT NULL DEFAULT '0',
	`is_staff_picked` varchar(1) NOT NULL DEFAULT '0',
	`allow_other_pets` varchar(1) NOT NULL DEFAULT '0',
	`allow_other_pets_eat` varchar(1) NOT NULL DEFAULT '0',
	`allow_walkthrough` varchar(1) NOT NULL DEFAULT '1',
	`allow_hidewall` varchar(1) NOT NULL DEFAULT '0',
	`chat_mode` int NOT NULL DEFAULT 0,
	`chat_weight` int NOT NULL DEFAULT 1,
	`chat_speed` int NOT NULL DEFAULT 1,
	`chat_hearing_distance` int NOT NULL DEFAULT 50,
	`chat_protection` int NOT NULL DEFAULT 2,
	`override_model` varchar(1) NOT NULL DEFAULT '0',
	`who_can_mute` int NOT NULL DEFAULT 0,
	`who_can_kick` int NOT NULL DEFAULT 0,
	`who_can_ban` int NOT NULL DEFAULT 0,
	`poll_id` int NOT NULL DEFAULT 0,
	`roller_speed` int NOT NULL DEFAULT 4,
	`promoted` varchar(1) NOT NULL DEFAULT '0',
	`trade_mode` int NOT NULL DEFAULT 2,
	`move_diagonally` varchar(1) NOT NULL DEFAULT '1',
	`jukebox_active` varchar(1) NOT NULL DEFAULT '0',
	`hidewired` varchar(1) NOT NULL DEFAULT '0',
	`is_forsale` varchar(1) NOT NULL DEFAULT '0',
	CONSTRAINT `rooms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sanction_levels` (
	`level` int NOT NULL,
	`type` varchar(5) NOT NULL,
	`hour_length` int NOT NULL,
	`probation_days` int NOT NULL,
	CONSTRAINT `sanction_levels_level` PRIMARY KEY(`level`)
);
--> statement-breakpoint
CREATE TABLE `sanctions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`habbo_id` int NOT NULL DEFAULT 0,
	`sanction_level` int NOT NULL DEFAULT 0,
	`probation_timestamp` int NOT NULL DEFAULT 0,
	`reason` varchar(255) NOT NULL DEFAULT '',
	`trade_locked_until` int NOT NULL DEFAULT 0,
	`is_muted` tinyint NOT NULL DEFAULT 0,
	`mute_duration` int NOT NULL DEFAULT 0,
	CONSTRAINT `sanctions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`avatar` varchar(255),
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_accounts_provider_providerId` UNIQUE(`provider`,`provider_id`)
);
--> statement-breakpoint
CREATE TABLE `soundtracks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	`author` varchar(50) NOT NULL,
	`track` text NOT NULL,
	`length` int NOT NULL DEFAULT 0,
	CONSTRAINT `soundtracks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_activities` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`action` varchar(50) NOT NULL,
	`target_type` varchar(100),
	`target_id` bigint unsigned,
	`description` text NOT NULL,
	`ip_address` varchar(45),
	`metadata` longtext,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp,
	CONSTRAINT `staff_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_cfh_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name_internal` varchar(255),
	`name_external` varchar(255),
	CONSTRAINT `support_cfh_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_cfh_topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int,
	`name_internal` varchar(255),
	`name_external` varchar(255),
	`action` varchar(11) DEFAULT 'mods',
	`ignore_target` varchar(1) NOT NULL DEFAULT '0',
	`auto_reply` text,
	`default_sanction` int NOT NULL DEFAULT 0,
	CONSTRAINT `support_cfh_topics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_issue_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'PII',
	CONSTRAINT `support_issue_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_issue_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` int NOT NULL DEFAULT 1,
	`name` varchar(100) NOT NULL DEFAULT '',
	`message` varchar(300) NOT NULL DEFAULT '',
	`reminder` varchar(100) NOT NULL,
	`ban_for` int NOT NULL DEFAULT 0,
	`mute_for` int NOT NULL DEFAULT 0,
	CONSTRAINT `support_issue_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(4) NOT NULL DEFAULT 'user',
	`preset` varchar(200) NOT NULL,
	CONSTRAINT `support_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state` int NOT NULL DEFAULT 0,
	`type` int NOT NULL DEFAULT 1,
	`timestamp` int NOT NULL DEFAULT 0,
	`score` int NOT NULL DEFAULT 0,
	`sender_id` int NOT NULL DEFAULT 0,
	`reported_id` int NOT NULL DEFAULT 0,
	`room_id` int NOT NULL DEFAULT 0,
	`mod_id` int NOT NULL DEFAULT 0,
	`issue` varchar(500) NOT NULL DEFAULT '',
	`category` int NOT NULL DEFAULT 0,
	`group_id` int NOT NULL,
	`thread_id` int NOT NULL,
	`comment_id` int NOT NULL,
	`photo_item_id` int NOT NULL DEFAULT -1,
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `taggables` (
	`tag_id` bigint unsigned NOT NULL,
	`taggable_id` bigint unsigned NOT NULL,
	`taggable_type` varchar(255) NOT NULL,
	CONSTRAINT `taggables_tagId_taggableId_taggableType` UNIQUE(`tag_id`,`taggable_id`,`taggable_type`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`background_color` varchar(10) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `theme_scopes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`type` enum('global','site','module','route') NOT NULL,
	`parent_id` bigint unsigned,
	`site_domain` varchar(255),
	`route_path` varchar(255),
	`module_id` varchar(100),
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `theme_scopes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `theme_scope_values` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`scope_id` bigint unsigned NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_val` varchar(255) NOT NULL,
	`mode` enum('light','dark') NOT NULL DEFAULT 'light',
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `theme_scope_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `theme_scope_values_unique` UNIQUE(`scope_id`,`setting_key`,`mode`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(25) NOT NULL,
	`real_name` varchar(25) NOT NULL DEFAULT 'KREWS DEV',
	`password` varchar(255) NOT NULL,
	`mail` varchar(500),
	`mail_verified` varchar(1) NOT NULL DEFAULT '0',
	`account_created` int NOT NULL,
	`account_day_of_birth` int NOT NULL DEFAULT 0,
	`last_login` int NOT NULL DEFAULT 0,
	`last_online` int NOT NULL DEFAULT 0,
	`motto` varchar(127) NOT NULL DEFAULT '',
	`look` varchar(256) NOT NULL DEFAULT '',
	`gender` enum('M','F') NOT NULL DEFAULT 'M',
	`rank` int NOT NULL DEFAULT 1,
	`credits` int NOT NULL DEFAULT 2500,
	`pixels` int NOT NULL DEFAULT 500,
	`points` int NOT NULL DEFAULT 10,
	`online` varchar(1) NOT NULL DEFAULT '0',
	`auth_ticket` varchar(256) NOT NULL DEFAULT '',
	`ip_register` varchar(255) NOT NULL,
	`ip_current` varchar(255) NOT NULL,
	`machine_id` varchar(64) NOT NULL DEFAULT '',
	`home_room` int NOT NULL DEFAULT 0,
	`secret_key` varchar(40),
	`pincode` varchar(11),
	`terms_accepted` boolean NOT NULL DEFAULT false,
	`age_verified` boolean NOT NULL DEFAULT false,
	`extra_rank` int,
	`two_factor_secret` text,
	`two_factor_recovery_codes` text,
	`two_factor_confirmed_at` timestamp,
	`website_jwt_version` int NOT NULL DEFAULT 0,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `user_challenge_progress` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`challenge_id` bigint unsigned NOT NULL,
	`progress` int NOT NULL DEFAULT 0,
	`completed` boolean NOT NULL DEFAULT false,
	`claimed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `user_challenge_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_challenge_progress_userId_challengeId` UNIQUE(`user_id`,`challenge_id`)
);
--> statement-breakpoint
CREATE TABLE `user_game_ranks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`game` varchar(255) NOT NULL,
	`rank_id` bigint unsigned NOT NULL,
	`points` int NOT NULL DEFAULT 0,
	`wins` int NOT NULL DEFAULT 0,
	`games_played` int NOT NULL DEFAULT 0,
	`win_streak` int NOT NULL DEFAULT 0,
	`best_streak` int NOT NULL DEFAULT 0,
	`last_played_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `user_game_ranks_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_game_ranks_userId_game` UNIQUE(`user_id`,`game`)
);
--> statement-breakpoint
CREATE TABLE `user_game_xp` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`game` varchar(255) NOT NULL,
	`xp` int NOT NULL DEFAULT 0,
	`level` int NOT NULL DEFAULT 1,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `user_game_xp_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_game_xp_userId_game` UNIQUE(`user_id`,`game`)
);
--> statement-breakpoint
CREATE TABLE `user_referrals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`referrals_total` bigint unsigned NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `user_referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_watch` (
	`id` int AUTO_INCREMENT NOT NULL,
	`staff_id` int NOT NULL,
	`target_user_id` int NOT NULL,
	`reason` varchar(255) NOT NULL DEFAULT '',
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_watch_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_watch_staffId_targetUserId` UNIQUE(`staff_id`,`target_user_id`)
);
--> statement-breakpoint
CREATE TABLE `users_achievements` (
	`user_id` int NOT NULL,
	`achievement_name` varchar(255) NOT NULL,
	`progress` int NOT NULL DEFAULT 1,
	CONSTRAINT `users_achievements_userId_achievementName` UNIQUE(`user_id`,`achievement_name`)
);
--> statement-breakpoint
CREATE TABLE `users_achievements_queue` (
	`user_id` int NOT NULL,
	`achievement_id` int NOT NULL,
	`amount` int NOT NULL,
	CONSTRAINT `users_achievements_queue_userId_achievementId` UNIQUE(`user_id`,`achievement_id`)
);
--> statement-breakpoint
CREATE TABLE `users_badges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`slot_id` int NOT NULL DEFAULT 0,
	`badge_code` varchar(32) NOT NULL,
	CONSTRAINT `users_badges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users_clothing` (
	`user_id` int NOT NULL,
	`clothing_id` int NOT NULL,
	CONSTRAINT `users_clothing_userId_clothingId` UNIQUE(`user_id`,`clothing_id`)
);
--> statement-breakpoint
CREATE TABLE `users_currency` (
	`user_id` int NOT NULL,
	`type` int NOT NULL,
	`amount` int NOT NULL DEFAULT 0,
	CONSTRAINT `users_currency_user_id_type_pk` PRIMARY KEY(`user_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `users_effects` (
	`user_id` int NOT NULL,
	`effect` int NOT NULL,
	`duration` int NOT NULL DEFAULT 86400,
	`activation_timestamp` int NOT NULL DEFAULT -1,
	`total` int NOT NULL DEFAULT 1,
	CONSTRAINT `users_effects_userId_effect` UNIQUE(`user_id`,`effect`)
);
--> statement-breakpoint
CREATE TABLE `users_favorite_rooms` (
	`user_id` int NOT NULL,
	`room_id` int NOT NULL,
	CONSTRAINT `users_favorite_rooms_userId_roomId` UNIQUE(`user_id`,`room_id`)
);
--> statement-breakpoint
CREATE TABLE `users_pets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`room_id` int NOT NULL,
	`name` varchar(15) NOT NULL DEFAULT 'User Pet',
	`race` int NOT NULL,
	`type` int NOT NULL,
	`color` varchar(6) NOT NULL,
	`happyness` int NOT NULL DEFAULT 100,
	`experience` int NOT NULL DEFAULT 0,
	`energy` int NOT NULL DEFAULT 100,
	`hunger` int NOT NULL DEFAULT 0,
	`thirst` int NOT NULL DEFAULT 0,
	`respect` int NOT NULL DEFAULT 0,
	`created` int NOT NULL,
	`x` int NOT NULL DEFAULT 0,
	`y` int NOT NULL DEFAULT 0,
	`z` double NOT NULL DEFAULT 0,
	`rot` int NOT NULL DEFAULT 0,
	`hair_style` int NOT NULL DEFAULT -1,
	`hair_color` int NOT NULL DEFAULT 0,
	`saddle` varchar(1) NOT NULL DEFAULT '0',
	`ride` varchar(1) NOT NULL DEFAULT '0',
	`mp_type` int NOT NULL DEFAULT 0,
	`mp_color` int NOT NULL DEFAULT 0,
	`mp_nose` int NOT NULL DEFAULT 0,
	`mp_nose_color` tinyint NOT NULL DEFAULT 0,
	`mp_eyes` int NOT NULL DEFAULT 0,
	`mp_eyes_color` tinyint NOT NULL DEFAULT 0,
	`mp_mouth` int NOT NULL DEFAULT 0,
	`mp_mouth_color` tinyint NOT NULL DEFAULT 0,
	`mp_death_timestamp` int NOT NULL DEFAULT 0,
	`mp_breedable` varchar(1) NOT NULL DEFAULT '0',
	`mp_allow_breed` varchar(1) NOT NULL DEFAULT '0',
	`gnome_data` varchar(80) NOT NULL DEFAULT '',
	`mp_is_dead` tinyint NOT NULL DEFAULT 0,
	`saddle_item_id` int,
	CONSTRAINT `users_pets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users_recipes` (
	`user_id` int NOT NULL,
	`recipe` int NOT NULL,
	CONSTRAINT `users_recipes_userId_recipe` UNIQUE(`user_id`,`recipe`)
);
--> statement-breakpoint
CREATE TABLE `users_saved_searches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`search_code` varchar(255) NOT NULL,
	`filter` varchar(255),
	`user_id` int NOT NULL,
	CONSTRAINT `users_saved_searches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`credits` int NOT NULL DEFAULT 0,
	`achievement_score` int NOT NULL DEFAULT 0,
	`daily_respect_points` int NOT NULL DEFAULT 3,
	`daily_pet_respect_points` int NOT NULL DEFAULT 3,
	`respects_given` int NOT NULL DEFAULT 0,
	`respects_received` int NOT NULL DEFAULT 0,
	`guild_id` int NOT NULL DEFAULT 0,
	`can_change_name` varchar(1) NOT NULL DEFAULT '0',
	`can_trade` varchar(1) NOT NULL DEFAULT '1',
	`is_citizen` varchar(1) NOT NULL DEFAULT '0',
	`citizen_level` int NOT NULL DEFAULT 0,
	`helper_level` int NOT NULL DEFAULT 0,
	`tradelock_amount` int NOT NULL DEFAULT 0,
	`cfh_send` int NOT NULL DEFAULT 0,
	`cfh_abusive` int NOT NULL DEFAULT 0,
	`cfh_warnings` int NOT NULL DEFAULT 0,
	`cfh_bans` int NOT NULL DEFAULT 0,
	`block_following` varchar(1) NOT NULL DEFAULT '0',
	`block_friendrequests` varchar(1) NOT NULL DEFAULT '0',
	`block_roominvites` varchar(1) NOT NULL DEFAULT '0',
	`volume_system` int NOT NULL DEFAULT 100,
	`volume_furni` int NOT NULL DEFAULT 100,
	`volume_trax` int NOT NULL DEFAULT 100,
	`old_chat` varchar(1) NOT NULL DEFAULT '0',
	`block_camera_follow` varchar(1) NOT NULL DEFAULT '0',
	`chat_color` int NOT NULL DEFAULT 0,
	`home_room` int NOT NULL DEFAULT 0,
	`online_time` int NOT NULL DEFAULT 0,
	`tags` varchar(255) NOT NULL DEFAULT 'Arcturus Emulator;',
	`club_expire_timestamp` int NOT NULL DEFAULT 0,
	`login_streak` int NOT NULL DEFAULT 0,
	`rent_space_id` int NOT NULL DEFAULT 0,
	`rent_space_endtime` int NOT NULL DEFAULT 0,
	`hof_points` int NOT NULL DEFAULT 0,
	`block_alerts` varchar(1) NOT NULL DEFAULT '0',
	`talent_track_citizenship_level` int NOT NULL DEFAULT -1,
	`talent_track_helpers_level` int NOT NULL DEFAULT -1,
	`ignore_bots` varchar(1) NOT NULL DEFAULT '0',
	`ignore_pets` varchar(1) NOT NULL DEFAULT '0',
	`nux` varchar(1) NOT NULL DEFAULT '0',
	`mute_end_timestamp` int NOT NULL DEFAULT 0,
	`allow_name_change` varchar(1) NOT NULL DEFAULT '0',
	`perk_trade` varchar(1) NOT NULL DEFAULT '0',
	`forums_post_count` int DEFAULT 0,
	`ui_flags` int NOT NULL DEFAULT 1,
	`has_gotten_default_saved_searches` tinyint NOT NULL DEFAULT 0,
	`hc_gifts_claimed` int DEFAULT 0,
	`last_hc_payday` int DEFAULT 0,
	`max_rooms` int DEFAULT 50,
	`max_friends` int DEFAULT 300,
	CONSTRAINT `users_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_settings_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users_subscriptions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`subscription_type` varchar(255),
	`timestamp_start` int unsigned,
	`duration` int unsigned,
	`active` tinyint DEFAULT 1,
	CONSTRAINT `users_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users_target_offer_purchases` (
	`user_id` int NOT NULL,
	`offer_id` int NOT NULL,
	`state` int NOT NULL DEFAULT 0,
	`amount` int NOT NULL DEFAULT 0,
	`last_purchase` int NOT NULL DEFAULT 0,
	CONSTRAINT `users_target_offer_purchases_userId_offerId` UNIQUE(`user_id`,`offer_id`)
);
--> statement-breakpoint
CREATE TABLE `users_wardrobe` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`slot_id` int NOT NULL DEFAULT 0,
	`look` varchar(256) NOT NULL,
	`gender` varchar(1) NOT NULL DEFAULT 'F',
	CONSTRAINT `users_wardrobe_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voucher_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`voucher_id` int NOT NULL,
	`user_id` int NOT NULL,
	`timestamp` int NOT NULL,
	CONSTRAINT `voucher_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(10) NOT NULL,
	`credits` int NOT NULL DEFAULT 0,
	`points` int NOT NULL DEFAULT 0,
	`points_type` int NOT NULL DEFAULT 0,
	`catalog_item_id` int NOT NULL DEFAULT 0,
	`amount` int NOT NULL DEFAULT 1,
	`limit` int NOT NULL DEFAULT -1,
	CONSTRAINT `vouchers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_ads` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`image` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_ads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_article_comments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`article_id` bigint unsigned NOT NULL,
	`user_id` int NOT NULL,
	`comment` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_article_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_article_reactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`article_id` bigint unsigned NOT NULL,
	`reaction` varchar(50) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `website_article_reactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_articles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`short_story` varchar(255) NOT NULL,
	`full_story` longtext NOT NULL,
	`user_id` int,
	`image` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	`status` varchar(20) NOT NULL DEFAULT 'published',
	`publish_at` timestamp,
	`published_at` timestamp,
	CONSTRAINT `website_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_articles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `website_badges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`badge_key` varchar(255) NOT NULL,
	`badge_name` varchar(255) NOT NULL,
	`badge_description` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_badges_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_badges_badge_key_unique` UNIQUE(`badge_key`)
);
--> statement-breakpoint
CREATE TABLE `website_banners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT '',
	`subtitle` varchar(500) NOT NULL DEFAULT '',
	`image` varchar(500) NOT NULL DEFAULT '',
	`link` varchar(500) NOT NULL DEFAULT '',
	`color` varchar(20) NOT NULL DEFAULT '',
	`is_active` int NOT NULL DEFAULT 1,
	`sort_order` int NOT NULL DEFAULT 0,
	`start_date` varchar(50),
	`end_date` varchar(50),
	CONSTRAINT `website_banners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_beta_codes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(255) NOT NULL,
	`user_id` int,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_beta_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_beta_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `website_drawbadges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`badge_path` varchar(255) NOT NULL,
	`badge_url` varchar(255) NOT NULL,
	`badge_name` varchar(255) NOT NULL,
	`badge_desc` varchar(255) NOT NULL,
	`published` boolean NOT NULL DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_drawbadges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`type_id` int NOT NULL,
	`host_user_id` int NOT NULL,
	`room_id` int,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3),
	`max_players` int,
	`is_recurring` int NOT NULL DEFAULT 0,
	`recurrence_rule` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`image` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `website_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_event_prizes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`position` int NOT NULL DEFAULT 1,
	`prize_type` varchar(20) NOT NULL DEFAULT 'badge',
	`badge_code` varchar(50),
	`credits` int NOT NULL DEFAULT 0,
	`pixels` int NOT NULL DEFAULT 0,
	`points` int NOT NULL DEFAULT 0,
	`item_id` int,
	`description` varchar(255) NOT NULL DEFAULT '',
	CONSTRAINT `website_event_prizes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_event_registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`user_id` int NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `website_event_registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_event_registrations_eventId_userId` UNIQUE(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `website_event_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` varchar(500) NOT NULL DEFAULT '',
	`color` varchar(20) NOT NULL DEFAULT '#3b82f6',
	`icon` varchar(50) NOT NULL DEFAULT 'calendar',
	`is_active` int NOT NULL DEFAULT 1,
	`min_rank` int NOT NULL DEFAULT 0,
	CONSTRAINT `website_event_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_event_types_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `website_event_winners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_id` int NOT NULL,
	`user_id` int NOT NULL,
	`position` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `website_event_winners_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_event_winners_eventId_userId` UNIQUE(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `website_help_center_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`position` int unsigned NOT NULL DEFAULT 1,
	`image_url` varchar(255),
	`button_text` varchar(255),
	`button_url` varchar(255),
	`button_color` varchar(16) NOT NULL DEFAULT '#eeb425',
	`button_border_color` varchar(16) NOT NULL DEFAULT '#facc15',
	`small_box` boolean NOT NULL DEFAULT false,
	CONSTRAINT `website_help_center_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_help_center_categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `website_help_center_ticket_replies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ticket_id` bigint unsigned NOT NULL,
	`user_id` int NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_help_center_ticket_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_help_center_tickets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`category_id` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`open` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_help_center_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_housekeeping_permissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`permission` varchar(255) NOT NULL,
	`min_rank` int NOT NULL,
	`description` varchar(255),
	`group_name` varchar(100),
	`depends_on` varchar(255),
	`updated_by` int,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_housekeeping_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_housekeeping_permissions_permission_unique` UNIQUE(`permission`)
);
--> statement-breakpoint
CREATE TABLE `website_installation` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`step` int unsigned DEFAULT 0,
	`completed` boolean NOT NULL DEFAULT false,
	`installation_key` varchar(255),
	`user_ip` varchar(255),
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_installation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_ip_blacklist` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ip_address` varchar(255) NOT NULL,
	`asn` varchar(255),
	`blacklist_asn` boolean NOT NULL DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_ip_blacklist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_ip_whitelist` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ip_address` varchar(255) NOT NULL,
	`asn` varchar(255),
	`whitelist_asn` boolean NOT NULL DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_ip_whitelist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_languages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`country_code` varchar(8) NOT NULL,
	`language` varchar(255) NOT NULL,
	CONSTRAINT `website_languages_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_languages_country_code_unique` UNIQUE(`country_code`),
	CONSTRAINT `website_languages_language_unique` UNIQUE(`language`)
);
--> statement-breakpoint
CREATE TABLE `website_login_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`ip` varchar(45) NOT NULL,
	`user_agent` varchar(512),
	`created_at` timestamp,
	CONSTRAINT `website_login_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_maintenance_tasks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`task` varchar(255) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_maintenance_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_open_positions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`permission_id` int NOT NULL,
	`description` text NOT NULL,
	`apply_from` timestamp,
	`apply_to` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_open_positions_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_open_positions_permission_id_unique` UNIQUE(`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `website_paypal_transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`transaction_id` varchar(255) NOT NULL,
	`status` varchar(255),
	`description` varchar(512),
	`amount` double NOT NULL,
	`currency` varchar(255) NOT NULL DEFAULT 'USD',
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_paypal_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_permissions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`permission` varchar(255) NOT NULL,
	`min_rank` varchar(255) NOT NULL,
	`description` varchar(255),
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_permissions_permission_unique` UNIQUE(`permission`)
);
--> statement-breakpoint
CREATE TABLE `website_polls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`status` varchar(20) NOT NULL DEFAULT 'draft',
	`show_results` int NOT NULL DEFAULT 1,
	`multiple_choice` int NOT NULL DEFAULT 0,
	`starts_at` datetime(3),
	`ends_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `website_polls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_poll_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`poll_id` int NOT NULL,
	`question` varchar(500) NOT NULL,
	`type` varchar(20) NOT NULL DEFAULT 'single',
	`sort_order` int NOT NULL DEFAULT 0,
	`options` text NOT NULL,
	CONSTRAINT `website_poll_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_poll_votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`question_id` int NOT NULL,
	`user_id` int NOT NULL,
	`answer` varchar(500) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `website_poll_votes_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_poll_votes_questionId_userId` UNIQUE(`question_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `website_rare_value_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`badge` varchar(255) NOT NULL,
	`priority` int unsigned NOT NULL DEFAULT 1,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_rare_value_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_rare_value_categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `website_rare_values` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`item_id` int,
	`name` varchar(255) NOT NULL,
	`credit_value` varchar(255),
	`currency_value` varchar(255),
	`currency_type` varchar(255) NOT NULL DEFAULT 'diamonds',
	`furniture_icon` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_rare_values_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_rule_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255) NOT NULL,
	`badge` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_rule_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_rule_categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `website_rules` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`category_id` bigint unsigned,
	`paragraph` varchar(8) NOT NULL,
	`rule` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_settings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`comment` varchar(255),
	CONSTRAINT `website_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `website_shop_article_features` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`article_id` bigint unsigned NOT NULL,
	`content` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_shop_article_features_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_shop_articles` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`website_shop_category_id` bigint unsigned,
	`name` varchar(255) NOT NULL,
	`info` varchar(255) NOT NULL,
	`icon_url` varchar(255) NOT NULL,
	`color` varchar(255) NOT NULL,
	`costs` int unsigned NOT NULL,
	`give_rank` int,
	`is_giftable` boolean NOT NULL DEFAULT false,
	`credits` int unsigned,
	`duckets` int unsigned,
	`diamonds` int unsigned,
	`badges` varchar(255),
	`furniture` longtext,
	`position` int unsigned NOT NULL DEFAULT 0,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_shop_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_shop_articles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `website_shop_categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`icon` varchar(255),
	`order` int NOT NULL DEFAULT 0,
	CONSTRAINT `website_shop_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_shop_vouchers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(255) NOT NULL,
	`max_uses` int unsigned NOT NULL DEFAULT 1,
	`use_count` int unsigned NOT NULL DEFAULT 0,
	`amount` int unsigned NOT NULL,
	`expires_at` timestamp,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_shop_vouchers_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_shop_vouchers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `website_staff_applications` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`rank_id` int NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_staff_applications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_teams` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`rank_name` varchar(255) NOT NULL,
	`hidden_rank` boolean NOT NULL DEFAULT false,
	`badge` varchar(255),
	`job_description` varchar(255),
	`staff_color` varchar(255) NOT NULL DEFAULT '#327fa8',
	`staff_background` varchar(255) NOT NULL DEFAULT 'staff-bg.png',
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_teams_rank_name_unique` UNIQUE(`rank_name`)
);
--> statement-breakpoint
CREATE TABLE `website_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subject` varchar(255) NOT NULL,
	`category` varchar(50) NOT NULL DEFAULT 'general',
	`priority` varchar(20) NOT NULL DEFAULT 'normal',
	`status` varchar(20) NOT NULL DEFAULT 'open',
	`creator_id` int NOT NULL,
	`assignee_id` int,
	`closed_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `website_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_ticket_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticket_id` int NOT NULL,
	`user_id` int NOT NULL,
	`message` text NOT NULL,
	`is_staff` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `website_ticket_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_ticket_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`category` varchar(50) NOT NULL DEFAULT 'general',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `website_ticket_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_used_shop_vouchers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`voucher_id` bigint unsigned NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_used_shop_vouchers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_user_guestbooks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`profile_id` int NOT NULL,
	`user_id` int NOT NULL,
	`message` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_user_guestbooks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `website_wordfilter` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`word` varchar(255) NOT NULL,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_wordfilter_id` PRIMARY KEY(`id`),
	CONSTRAINT `website_wordfilter_word_unique` UNIQUE(`word`)
);
--> statement-breakpoint
CREATE TABLE `website_writeable_boxes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`icon` varchar(255),
	`content` text NOT NULL,
	`position` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp,
	`updated_at` timestamp,
	CONSTRAINT `website_writeable_boxes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `youtube_playlists` (
	`item_id` int NOT NULL,
	`playlist_id` varchar(255) NOT NULL,
	`order` int NOT NULL,
	CONSTRAINT `youtube_playlists_itemId_playlistId_order` UNIQUE(`item_id`,`playlist_id`,`order`)
);
