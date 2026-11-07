# Eight pre-existing wrong attachments

All text below is generated synthetic fixture text. Scores reproduce the committed search resolver before the fix. Full = complete context sides; evidence = matching non-whitespace context characters; similarity = normalized Levenshtein; distance = UTF-16 offset difference. These cases were found outside the original two fixed seeds.

## 706199775/948: duplicate

Before:

```text
The service uses Redis for temporary session storage.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

Cache invalidation follows the deployment boundary.

A short answer should cite the selected project evidence.
```

After:

```text
The service uses Redis for temporary session storage.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

Cache invalidation follows the deployment boundary.

A short answer should cite the selected project evidence.

Cache invalidation follows the deployment boundary.

A short answer should cite the selected project evidence.
```

Captured quote: "Cache invalidation follows the deployment boundary."

Prefix: "ce.\n\nA short answer should cite the selected project evidence.\n\n"

Suffix: "\n\nA short answer should cite the selected project evidence."

Original after: {"from":344,"to":395}. Wrong attachment: 232-283.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 232-283 | 2 | 101 | 1.000000 | 59 |
| 344-395 | 1 | 99 | 1.000000 | 53 |

## 706199776/668: duplicate

Before:

```text
The migration waits for a human review of the evidence.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.
```

After:

```text
The migration waits for a human review of the evidence.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.
```

Captured quote: "A short answer should cite the selected project evidence."

Prefix: "orage.\n\nThe service uses SQLite for temporary session storage.\n\n"

Suffix: "\n\nThe service uses SQLite for temporary session storage."

Original after: {"from":340,"to":397}. Wrong attachment: 225-282.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 225-282 | 2 | 100 | 1.000000 | 56 |
| 340-397 | 1 | 96 | 1.000000 | 59 |

## 706199780/578: duplicate

Before:

```text
The migration waits for a human review of the evidence.

A short answer should cite the selected project evidence.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.
```

After:

```text
The migration waits for a human review of the evidence.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.
```

Captured quote: "The service uses SQLite for temporary session storage."

Prefix: "ce.\n\nA short answer should cite the selected project evidence.\n\n"

Suffix: "\n\nA short answer should cite the selected project evidence."

Original after: {"from":231,"to":285}. Wrong attachment: 116-170.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 116-170 | 2 | 101 | 1.000000 | 59 |
| 231-285 | 1 | 100 | 1.000000 | 56 |

## 706199782/386: delete

Before:

```text
The migration waits for a human review of the evidence.

The service uses SQLite for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The migration waits for a human review of the evidence.

Cache invalidation follows the deployment boundary.
```

After:

```text
The migration waits for a human review of the evidence.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The migration waits for a human review of the evidence.

Cache invalidation follows the deployment boundary.
```

Captured quote: "The service uses SQLite for temporary session storage."

Prefix: "The migration waits for a human review of the evidence.\n\n"

Suffix: "\n\nThe service uses Redis for temporary session storage.\n\nThe ser"

Original after: null. Wrong attachment: 57-110.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 57-110 | 2 | 98 | 0.907407 | 0 |

## 706199782/411: delete

Before:

```text
Cache invalidation follows the deployment boundary.

The migration waits for a human review of the evidence.

The service uses Redis for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.
```

After:

```text
Cache invalidation follows the deployment boundary.

The migration waits for a human review of the evidence.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

The service uses SQLite for temporary session storage.

A short answer should cite the selected project evidence.
```

Captured quote: "The service uses Redis for temporary session storage."

Prefix: "dary.\n\nThe migration waits for a human review of the evidence.\n\n"

Suffix: "\n\nThe service uses SQLite for temporary session storage.\n\nThe se"

Original after: null. Wrong attachment: 110-164.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 110-164 | 2 | 103 | 0.907407 | 0 |

## 706199784/176: delete

Before:

```text
The service uses SQLite for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.
```

After:

```text
The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.
```

Captured quote: "The service uses SQLite for temporary session storage."

Prefix: ""

Suffix: "\n\nThe service uses Redis for temporary session storage.\n\nThe ser"

Original after: null. Wrong attachment: 0-53.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 0-53 | 2 | 52 | 0.907407 | 0 |

## 706199784/411: delete

Before:

```text
The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses SQLite for temporary session storage.
```

After:

```text
The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.
```

Captured quote: "The service uses SQLite for temporary session storage."

Prefix: "torage.\n\nThe service uses Redis for temporary session storage.\n\n"

Suffix: ""

Original after: null. Wrong attachment: 165-218.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 165-218 | 2 | 53 | 0.907407 | 55 |

## 706199784/781: delete

Before:

```text
A short answer should cite the selected project evidence.

The service uses SQLite for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

A short answer should cite the selected project evidence.
```

After:

```text
A short answer should cite the selected project evidence.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

The service uses Redis for temporary session storage.

A short answer should cite the selected project evidence.
```

Captured quote: "The service uses SQLite for temporary session storage."

Prefix: "A short answer should cite the selected project evidence.\n\n"

Suffix: "\n\nThe service uses Redis for temporary session storage.\n\nThe ser"

Original after: null. Wrong attachment: 59-112.

| Candidate | Full | Evidence | Similarity | Distance |
| --- | ---: | ---: | ---: | ---: |
| 59-112 | 2 | 101 | 0.907407 | 0 |

## Fix proposal

Strict search attaches only an originally unique quote that still occurs exactly once. Fuzzy paragraphs and newly duplicated quotes remain suggestions, never automatic attachments. Known previous text enables the separate mapping path to recover actual edits. A higher fuzzy threshold alone cannot distinguish a one-character edit from deletion beside a one-character-different survivor.
