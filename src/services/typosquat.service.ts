import { env } from '../lib/config'
import { rankCandidates, type TyposquatCandidate } from '../analysis/typosquats'

interface NpmSearchObject {
  package?: {
    name?: string
    version?: string
    description?: string
  }
  score?: {
    detail?: {
      popularity?: number
    }
  }
}

interface NpmSearchResponse {
  objects?: NpmSearchObject[]
}

export async function getTyposquatCandidates(target: string): Promise<TyposquatCandidate[]> {
  const url = new URL('/-/v1/search', env.NPM_REGISTRY_URL)
  url.searchParams.set('text', target)
  url.searchParams.set('size', '25')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`npm search ${response.status}: ${await response.text()}`)
  }
  const data = (await response.json()) as NpmSearchResponse
  const candidates = (data.objects ?? []).map((entry) => ({
    name: entry.package?.name ?? '',
    version: entry.package?.version ?? '',
    description: entry.package?.description ?? '',
    popularity: entry.score?.detail?.popularity ?? 0.5,
  }))
  return rankCandidates(target, candidates)
}
