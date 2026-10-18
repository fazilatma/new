<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * ردیفِ صف‌های ارسال — معادلِ entries در bsl_queue.json / woo_queue.json
 *  kind:    bsl_send | woo_send | extract | manual_sync
 *  status:  waiting | running | paused | done | failed | stopped
 *  payload: تنظیماتِ همان اجرا (category_id, force_all, send_all_shops, …)
 *  counters: sent/updated/skipped/failed/current + total
 */
class QueueEntry extends Model
{
    protected $fillable = [
        'kind', 'batch_id', 'profile_id', 'status',
        'payload', 'counters', 'started_at', 'done_at', 'error',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'counters' => 'array',
            'started_at' => 'datetime',
            'done_at' => 'datetime',
        ];
    }

    public function scopeAlive($q)
    {
        return $q->whereIn('status', ['waiting', 'running', 'paused']);
    }
}
