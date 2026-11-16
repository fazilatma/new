<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * چک‌پوینتِ کارهای طولانی — جای *_progress.json / *_checkpoint.json
 * state کاملِ وضعیتِ اجراست تا بعد از هر ری‌استارت/سقوط، کار از همان‌جا ادامه یابد.
 */
class TaskCheckpoint extends Model
{
    protected $fillable = ['task', 'queue_entry_id', 'state', 'heartbeat_at'];

    protected function casts(): array
    {
        return [
            'state' => 'array',
            'heartbeat_at' => 'datetime',
        ];
    }

    public static function read(string $task, array $default = []): array
    {
        $row = static::query()->where('task', $task)->first();
        return $row ? array_merge($default, (array) $row->state) : $default;
    }

    public static function write(string $task, array $state, ?int $queueEntryId = null): void
    {
        static::query()->updateOrCreate(
            ['task' => $task],
            ['state' => $state, 'queue_entry_id' => $queueEntryId, 'heartbeat_at' => now()]
        );
    }

    /** نبض — watchdog با همین تشخیصِ بی‌حرکتی می‌دهد */
    public static function beat(string $task): void
    {
        static::query()->where('task', $task)->update(['heartbeat_at' => now()]);
    }
}
