// ---------------------------------------------------------------------------
// Content classification labels
//
// Twitch offers six user-settable Content Classification Labels on its
// channel-update API (a seventh, "MatureGame", is applied automatically by
// Twitch from the category's rating and cannot be set). YouTube's API has no
// label catalogue — its only self-declarable classification is "Made for
// kids" (status.selfDeclaredMadeForKids). A series carries both (see
// content_series.go); they are applied with the rest of the stream info when
// a plan goes live. Mirrors twitchContentLabelIDs in planning.go.
// ---------------------------------------------------------------------------

export interface ContentLabelDef {
  id: string
  name: string
  description: string
}

/** Twitch's settable Content Classification Labels. */
export const TWITCH_CONTENT_LABELS: ContentLabelDef[] = [
  {
    id: 'DebatedSocialIssuesAndPolitics',
    name: 'Politics and Sensitive Social Issues',
    description:
      'Discussion or debate of politics or sensitive social issues (elections, military conflict, civil rights).',
  },
  {
    id: 'DrugsIntoxication',
    name: 'Drugs, Intoxication, or Excessive Tobacco Use',
    description:
      'Drug/alcohol-induced intoxication, marijuana consumption, discussion of illegal drugs, excessive tobacco use.',
  },
  {
    id: 'Gambling',
    name: 'Gambling',
    description:
      'Online or in-person gambling, poker, or fantasy sports involving real money.',
  },
  {
    id: 'ProfanityVulgarity',
    name: 'Significant Profanity or Vulgarity',
    description:
      'Prolonged, repeated use of obscenities and vulgarities as a regular part of speech.',
  },
  {
    id: 'SexualThemes',
    name: 'Sexual Themes',
    description:
      'Content focused on sexualized physical attributes, activities, or topics.',
  },
  {
    id: 'ViolentGraphic',
    name: 'Violent and Graphic Depictions',
    description:
      'Realistic violence, gore, extreme injury, or death (simulated or depicted).',
  },
]

/** Display name for a Twitch label id, falling back to the id itself. */
export function twitchLabelName(id: string): string {
  return TWITCH_CONTENT_LABELS.find((l) => l.id === id)?.name ?? id
}

/** YouTube's single self-declarable classification, for display alongside
 *  the Twitch labels. */
export const YOUTUBE_MADE_FOR_KIDS_NAME = 'Made for kids'
