/** Plain-text service areas. Keep in step with lib/google-business/service-area-text.ts. */

type ServiceAreaPayload = {
  account?: { business_name?: string | null; location_id?: string | null; id?: number | null }
  service_area?: {
    business_type_label?: string
    region_code?: string | null
    place_limit?: number
    places?: Array<{ place_id?: string; place_name?: string }>
  } | null
  message?: string
}

export function formatGoogleBusinessServiceArea(data: ServiceAreaPayload): string {
  const account = data.account || {}
  const area = data.service_area
  const name = account.business_name || 'This location'
  const lines = [`Google Business service areas: ${name}`]
  if (account.location_id) lines.push(`Location: ${account.location_id}`)
  if (!area) {
    lines.push('No service area was returned.')
    return lines.join('\n')
  }
  lines.push(area.business_type_label || 'No service area is set.')
  if (area.region_code) lines.push(`Country: ${area.region_code}`)
  const places = Array.isArray(area.places) ? area.places : []
  if (places.length === 0) {
    lines.push('No towns or postcodes are listed.')
  } else {
    lines.push(`Areas (${places.length} of ${area.place_limit || 20}):`)
    for (const place of places) {
      lines.push(`- ${place.place_name} :: ${place.place_id}`)
    }
  }
  if (data.message) lines.push('', data.message)
  return lines.join('\n')
}

export function formatGoogleBusinessServiceAreaPlaces(data: { query?: string; places?: Array<{ place_id?: string; place_name?: string }> }): string {
  const places = Array.isArray(data.places) ? data.places : []
  if (places.length === 0) {
    return `No matching towns or postcodes for "${data.query || ''}".`
  }
  const lines = [`Matching service areas for "${data.query || ''}":`]
  for (const place of places) {
    lines.push(`- ${place.place_name} :: ${place.place_id}`)
  }
  lines.push('', 'Use place_id and place_name together when you update service areas. Place IDs are regions, not the review-link Place ID.')
  return lines.join('\n')
}
