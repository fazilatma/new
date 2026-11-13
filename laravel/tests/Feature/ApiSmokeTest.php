<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiSmokeTest extends TestCase
{
    public function test_ping(): void
    {
        $this->getJson('/api/ping')
            ->assertOk()
            ->assertJsonPath('ok', true);
    }

    public function test_pagination_preview_covers_tilde_pattern(): void
    {
        $this->getJson('/api/pagination/preview?url=https://t.test/shop&type=path_pattern&val=~page~{page}&pages=3')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('urls.1', 'https://t.test/shop~page~2')
            ->assertJsonPath('urls.2', 'https://t.test/shop~page~3')
            ->assertJsonPath('urls.0', 'https://t.test/shop');
    }

    public function test_pagination_preview_validates_input(): void
    {
        $this->getJson('/api/pagination/preview?url=not-a-url&type=path_pattern')
            ->assertStatus(422);
    }
}
