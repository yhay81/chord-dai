WITH clean_events AS (
  SELECT name, session_id, day, created_at
  FROM product_events
  WHERE is_qa = 0
),
song_depth AS (
  SELECT session_id, COUNT(*) AS songs_created
  FROM clean_events
  WHERE name = 'song_created'
  GROUP BY session_id
),
performance_depth AS (
  SELECT
    session_id,
    COUNT(*) AS starts,
    COUNT(DISTINCT day) AS performance_days,
    julianday(MAX(day)) - julianday(MIN(day)) AS span_days
  FROM clean_events
  WHERE name = 'performance_started'
  GROUP BY session_id
),
funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN name = 'visited' THEN session_id END) AS users,
    COUNT(DISTINCT CASE WHEN name = 'song_created' THEN session_id END) AS song_creators,
    COUNT(DISTINCT CASE WHEN name = 'song_updated' THEN session_id END) AS song_editors,
    COUNT(DISTINCT CASE WHEN name = 'song_opened' THEN session_id END) AS song_openers,
    COUNT(DISTINCT CASE WHEN name = 'transpose_used' THEN session_id END) AS transpose_users,
    COUNT(DISTINCT CASE WHEN name = 'performance_started' THEN session_id END) AS performers,
    COUNT(DISTINCT CASE WHEN name = 'performance_completed' THEN session_id END) AS completers,
    COUNT(DISTINCT CASE WHEN name = 'metronome_started' THEN session_id END) AS metronome_users,
    COUNT(DISTINCT CASE WHEN name = 'project_exported' THEN session_id END) AS exporters,
    COUNT(DISTINCT CASE WHEN name = 'project_imported' THEN session_id END) AS importers,
    COUNT(DISTINCT CASE WHEN name = 'returned' THEN session_id END) AS returned,
    COUNT(DISTINCT CASE
      WHEN name = 'performance_started'
       AND created_at >= unixepoch() - 604800 THEN session_id
    END) AS performers_7d
  FROM clean_events
)
SELECT
  funnel.*,
  (SELECT COUNT(*) FROM song_depth WHERE songs_created >= 3) AS three_song_users,
  (SELECT COUNT(*) FROM performance_depth WHERE starts >= 3) AS three_performance_users,
  (SELECT COUNT(*) FROM performance_depth WHERE performance_days >= 3) AS three_day_performers,
  (SELECT COUNT(*) FROM performance_depth WHERE span_days >= 7) AS performers_spanning_7d
FROM funnel;
