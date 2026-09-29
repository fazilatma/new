<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * جایگزینِ فایل‌های JSON وضعیتِ نسخهٔ قدیمی:
 *   profiles.json      → profiles + products
 *   connections.json   → connections
 *   bsl_queue/woo_queue.json → queue_entries
 *   *_progress.json / checkpoints → task_checkpoints
 *
 * فایل‌های قدیمی پاک نمی‌شوند؛ دستورِ `scraper:import-legacy` یک‌بار آن‌ها را
 * اینجا وارد می‌کند تا دو نسل کنار هم بیایند (Strangler).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('profiles', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique();              // profileKey(url)
            $table->string('name')->default('');
            $table->string('url', 1024);
            $table->json('selectors')->nullable();
            $table->json('pagination')->nullable();       // {type, val}
            $table->json('settings')->nullable();         // gallery/detail/ai prefs
            $table->unsignedInteger('products_count')->default(0);
            $table->timestamp('last_scraped_at')->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->index('enabled');
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('profile_id')->constrained('profiles')->cascadeOnDelete();
            $table->string('key', 64);                    // productKey
            $table->string('title', 512)->default('');
            $table->string('price')->default('');
            $table->unsignedBigInteger('price_num')->default(0);
            $table->string('link', 1024)->default('');
            $table->string('image', 1024)->default('');
            $table->string('sku')->default('');
            $table->json('extra')->nullable();            // برند/تنوع/گالری/توضیح…
            $table->unsignedBigInteger('basalam_id')->nullable();
            $table->unsignedBigInteger('woo_id')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->unique(['profile_id', 'key']);
            $table->index('basalam_id');
            $table->index('woo_id');
        });

        Schema::create('connections', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();             // basalam|woocommerce|ai|notify|src_net|app
            $table->text('config')->nullable();           // encrypted JSON (cast)
            $table->timestamps();
        });

        Schema::create('queue_entries', function (Blueprint $table) {
            $table->id();
            $table->string('kind', 32);                   // bsl_send|woo_send|extract|manual_sync
            $table->string('batch_id', 64)->nullable();
            $table->foreignId('profile_id')->nullable()->constrained('profiles')->nullOnDelete();
            $table->string('status', 16)->default('waiting');
            $table->json('payload')->nullable();
            $table->json('counters')->nullable();         // {total,sent,updated,skipped,failed,current}
            $table->timestamp('started_at')->nullable();
            $table->timestamp('done_at')->nullable();
            $table->string('error', 512)->default('');
            $table->timestamps();

            $table->index(['kind', 'status']);
            $table->index('batch_id');
        });

        Schema::create('task_checkpoints', function (Blueprint $table) {
            $table->id();
            $table->string('task', 64)->unique();
            $table->foreignId('queue_entry_id')->nullable()->constrained('queue_entries')->nullOnDelete();
            $table->json('state')->nullable();
            $table->timestamp('heartbeat_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_checkpoints');
        Schema::dropIfExists('queue_entries');
        Schema::dropIfExists('connections');
        Schema::dropIfExists('products');
        Schema::dropIfExists('profiles');
    }
};
