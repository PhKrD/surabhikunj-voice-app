import useConfigStore from '@/store/configStore'
import useOrgStore from '@/store/orgStore'

/**
 * A remotely controlled on/off switch. The organisation's setting
 * (organization_settings.features) wins over the platform-wide default
 * (app_platform_config.feature_flags), which wins over `fallback`.
 *
 * Lets a feature be shipped dark and switched on — or switched off if it
 * misbehaves — without releasing anything.
 */
export default function useFeatureFlag(key, fallback = false) {
  const orgValue = useOrgStore((s) => s.settings?.features?.[key])
  const platformValue = useConfigStore((s) => s.platform?.feature_flags?.[key])
  if (typeof orgValue === 'boolean') return orgValue
  if (typeof platformValue === 'boolean') return platformValue
  return fallback
}
