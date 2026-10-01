<?php
/**
 * GitHub REST v3 connector. Port of agent-python/app/github_workspace.py.
 *
 * On this host the connector complements the local `git` CLI (clone/push over
 * HTTPS with the token) instead of replacing it.
 */

declare(strict_types=1);

namespace Arena;

final class GitHub
{
    public const API_BASE = 'https://api.github.com';

    public static function token(): string
    {
        $token = Config::raw('GITHUB_TOKEN', '');
        if ($token === '') {
            throw new HttpError(400, 'GITHUB_TOKEN is not configured in Environment settings.');
        }
        return $token;
    }

    public static function hasToken(): bool
    {
        return Config::raw('GITHUB_TOKEN', '') !== '';
    }

    private static function headers(): array
    {
        return [
            'Authorization' => 'Bearer ' . self::token(),
            'Accept' => 'application/vnd.github+json',
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'Arena-Agent-PHP/1.0',
            'Content-Type' => 'application/json',
        ];
    }

    public static function request(string $method, string $path, mixed $body = null, array $params = []): mixed
    {
        $url = self::API_BASE . '/' . ltrim($path, '/');
        $query = array_filter($params, static fn($v): bool => $v !== null && $v !== '');
        if ($query) {
            $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query);
        }
        $proxy = Config::proxyConfig($url);
        $payload = $body === null ? null : json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $r = HttpClient::request($method, $proxy['effectiveUrl'], self::headers(), $payload, 45, $proxy['proxyClient']);

        if ($r['status'] === 204) {
            return ['ok' => true];
        }
        $data = json_decode($r['body'], true);
        if ($data === null && $r['body'] !== '') {
            $data = $r['body'];
        }
        if ($r['status'] >= 400) {
            $message = is_array($data) && isset($data['message'])
                ? (string) $data['message']
                : (is_string($data) ? substr($data, 0, 500) : 'GitHub API error');
            throw new HttpError($r['status'], $message);
        }
        if ($r['error'] !== null) {
            throw new HttpError(502, 'GitHub request failed: ' . $r['error']);
        }
        return $data;
    }

    public static function get(string $path, array $params = []): mixed
    {
        return self::request('GET', $path, null, $params);
    }

    public static function post(string $path, mixed $body): mixed
    {
        return self::request('POST', $path, $body);
    }

    public static function put(string $path, mixed $body): mixed
    {
        return self::request('PUT', $path, $body);
    }

    public static function patch(string $path, mixed $body): mixed
    {
        return self::request('PATCH', $path, $body);
    }

    public static function delete(string $path, mixed $body = null): mixed
    {
        return self::request('DELETE', $path, $body);
    }

    // ------------------------------------------------- high level helpers

    public static function user(): mixed
    {
        return self::get('user');
    }

    public static function repos(): mixed
    {
        return self::get('user/repos', ['per_page' => 100, 'sort' => 'updated']);
    }

    public static function branches(string $owner, string $repo): mixed
    {
        return self::get("repos/{$owner}/{$repo}/branches", ['per_page' => 100]);
    }

    public static function tree(string $owner, string $repo, string $branch = 'main'): mixed
    {
        return self::get("repos/{$owner}/{$repo}/git/trees/{$branch}", ['recursive' => '1']);
    }

    public static function file(string $owner, string $repo, string $path, ?string $ref = null): mixed
    {
        $data = self::get("repos/{$owner}/{$repo}/contents/{$path}", ['ref' => $ref]);
        if (is_array($data) && ($data['encoding'] ?? '') === 'base64' && isset($data['content'])) {
            $decoded = base64_decode(str_replace("\n", '', (string) $data['content']), true);
            $data['decodedContent'] = $decoded === false ? null : $decoded;
        }
        return $data;
    }

    public static function putFile(
        string $owner,
        string $repo,
        string $path,
        string $content,
        string $message,
        ?string $branch = null,
        ?string $sha = null
    ): mixed {
        $fileSha = $sha;
        if ($fileSha === null) {
            try {
                $existing = self::get("repos/{$owner}/{$repo}/contents/{$path}", ['ref' => $branch]);
                $fileSha = is_array($existing) ? ($existing['sha'] ?? null) : null;
            } catch (\Throwable) {
                $fileSha = null;
            }
        }
        $body = [
            'message' => $message !== '' ? $message : "Update {$path} via Arena Agent",
            'content' => base64_encode($content),
        ];
        if ($branch !== null && $branch !== '') {
            $body['branch'] = $branch;
        }
        if ($fileSha !== null) {
            $body['sha'] = $fileSha;
        }
        return self::put("repos/{$owner}/{$repo}/contents/{$path}", $body);
    }

    public static function deleteFile(string $owner, string $repo, string $path, string $message, ?string $branch = null): mixed
    {
        $existing = self::get("repos/{$owner}/{$repo}/contents/{$path}", ['ref' => $branch]);
        $body = [
            'message' => $message !== '' ? $message : "Delete {$path} via Arena Agent",
            'sha' => is_array($existing) ? ($existing['sha'] ?? null) : null,
        ];
        if ($branch !== null && $branch !== '') {
            $body['branch'] = $branch;
        }
        return self::delete("repos/{$owner}/{$repo}/contents/{$path}", $body);
    }

    public static function pulls(string $owner, string $repo, string $state = 'open'): mixed
    {
        return self::get("repos/{$owner}/{$repo}/pulls", ['state' => $state, 'per_page' => 50]);
    }

    public static function pull(string $owner, string $repo, int $number): mixed
    {
        return self::get("repos/{$owner}/{$repo}/pulls/{$number}");
    }

    public static function createPull(string $owner, string $repo, array $body): mixed
    {
        return self::post("repos/{$owner}/{$repo}/pulls", $body);
    }

    public static function mergePull(string $owner, string $repo, int $number, array $body = []): mixed
    {
        return self::put("repos/{$owner}/{$repo}/pulls/{$number}/merge", $body);
    }

    public static function reviewPull(string $owner, string $repo, int $number, array $body): mixed
    {
        return self::post("repos/{$owner}/{$repo}/pulls/{$number}/reviews", $body);
    }

    public static function workflowRuns(string $owner, string $repo): mixed
    {
        return self::get("repos/{$owner}/{$repo}/actions/runs", ['per_page' => 30]);
    }

    public static function rerunWorkflow(string $owner, string $repo, int $runId): mixed
    {
        return self::post("repos/{$owner}/{$repo}/actions/runs/{$runId}/rerun", new \stdClass());
    }

    public static function issues(string $owner, string $repo, string $state = 'open'): mixed
    {
        return self::get("repos/{$owner}/{$repo}/issues", ['state' => $state, 'per_page' => 50]);
    }

    public static function createIssue(string $owner, string $repo, array $body): mixed
    {
        return self::post("repos/{$owner}/{$repo}/issues", $body);
    }

    public static function commentIssue(string $owner, string $repo, int $number, string $body): mixed
    {
        return self::post("repos/{$owner}/{$repo}/issues/{$number}/comments", ['body' => $body]);
    }

    /**
     * Clone a repository straight into a workspace using the local git CLI —
     * something the Workers port could not do at all.
     */
    public static function cloneIntoWorkspace(string $repoUrl, array $ws, string $branch = ''): array
    {
        $root = Workspaces::ensureRoot($ws);
        $token = self::hasToken() ? Config::raw('GITHUB_TOKEN', '') : null;
        $entries = array_diff(scandir($root) ?: [], ['.', '..']);
        if ($entries) {
            $tmp = $root . '/.arena-clone-' . Crypto::hex(3);
            $res = Git::clone($repoUrl, $tmp, $branch, $token);
            if (!$res['ok']) {
                Files::deleteTree($tmp);
                return $res;
            }
            foreach (array_diff(scandir($tmp) ?: [], ['.', '..']) as $item) {
                @rename($tmp . '/' . $item, $root . '/' . $item);
            }
            Files::deleteTree($tmp);
            return $res;
        }
        return Git::clone($repoUrl, $root, $branch, $token);
    }
}
