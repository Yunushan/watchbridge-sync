import { EXECUTABLE_SYNC_FEATURES, type ExecutableSyncFeature, type RuntimeWorkflow } from './runtimeSupport.js';
import { SERVICE_DEFINITIONS } from './services.js';
import type { ServiceId } from './types.js';

const MODEL_SYNC_FEATURES = ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'] as const;

export interface SupportMetric {
  supported: number;
  total: number;
  missing: number;
  percent: number;
  missingPercent: number;
  services?: ServiceId[];
}

export interface RuntimeSupportSummary {
  platforms: {
    selectable: SupportMetric;
    directAccount: SupportMetric;
    /** Platforms registering account read/write methods for all three executable families; not a universal cross-service compatibility claim. */
    fullThreeFeatureDirect: SupportMetric;
    anyLocalSourcePath: SupportMetric;
    metadataOrRecommendations: SupportMetric;
    restricted: SupportMetric;
    allModelFeaturesDirect: SupportMetric;
  };
  featureFamilies: {
    executable: SupportMetric;
    supported: string[];
    modelOnly: string[];
  };
  featureSlots: {
    sourceRead: SupportMetric;
    accountWrite: SupportMetric;
    automatedTarget: SupportMetric;
    byFeature: Record<ExecutableSyncFeature, {
      sourceRead: SupportMetric;
      accountWrite: SupportMetric;
      automatedTarget: SupportMetric;
    }>;
  };
  directions: {
    executable: SupportMetric;
    supported: ['one-way', 'two-way'];
    missing: [];
  };
  workflows: Record<RuntimeWorkflow, SupportMetric>;
}

function percentage(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 1_000) / 10;
}

function metric(supported: number, total: number, services?: ServiceId[]): SupportMetric {
  return {
    supported,
    total,
    missing: total - supported,
    percent: percentage(supported, total),
    missingPercent: percentage(total - supported, total),
    ...(services ? { services } : {})
  };
}

function hasEveryFeature(features: readonly ExecutableSyncFeature[]): boolean {
  return EXECUTABLE_SYNC_FEATURES.every((feature) => features.includes(feature));
}

/**
 * Derives the percentage snapshot from the exhaustive runtime registry. No
 * capability metadata or README claim can inflate these implementation counts.
 */
export function getRuntimeSupportSummary(): RuntimeSupportSummary {
  const totalPlatforms = SERVICE_DEFINITIONS.length;
  const featureSlotTotal = totalPlatforms * EXECUTABLE_SYNC_FEATURES.length;
  const serviceIds = SERVICE_DEFINITIONS.map((service) => service.id);
  const directAccount = SERVICE_DEFINITIONS.filter((service) => service.runtime.workflow === 'direct-account').map((service) => service.id);
  const fullThreeFeatureDirect = SERVICE_DEFINITIONS.filter((service) =>
    service.runtime.workflow === 'direct-account'
    && hasEveryFeature(service.runtime.accountReadFeatures)
    && hasEveryFeature(service.runtime.accountWriteFeatures)
  ).map((service) => service.id);
  const anyLocalSourcePath = SERVICE_DEFINITIONS.filter((service) =>
    service.runtime.accountReadFeatures.length > 0 || service.runtime.fileReadFeatures.length > 0
  ).map((service) => service.id);
  const metadataOrRecommendations = SERVICE_DEFINITIONS.filter((service) =>
    service.runtime.metadata || service.runtime.recommendations
  ).map((service) => service.id);
  const restricted = SERVICE_DEFINITIONS.filter((service) => service.runtime.workflow === 'restricted').map((service) => service.id);
  const sourceReadSlots = SERVICE_DEFINITIONS.reduce((total, service) => total + new Set([
    ...service.runtime.accountReadFeatures,
    ...service.runtime.fileReadFeatures
  ]).size, 0);
  const accountWriteSlots = SERVICE_DEFINITIONS.reduce(
    (total, service) => total + new Set(service.runtime.accountWriteFeatures).size,
    0
  );
  const automatedTargetSlots = SERVICE_DEFINITIONS.reduce((total, service) => total + new Set([
    ...service.runtime.accountWriteFeatures,
    ...service.runtime.generatedImportFileFeatures
  ]).size, 0);
  const byFeature = Object.fromEntries(EXECUTABLE_SYNC_FEATURES.map((feature) => {
    const sourceServices = SERVICE_DEFINITIONS.filter((service) =>
      service.runtime.accountReadFeatures.includes(feature) || service.runtime.fileReadFeatures.includes(feature)
    ).map((service) => service.id);
    const accountWriteServices = SERVICE_DEFINITIONS.filter((service) =>
      service.runtime.accountWriteFeatures.includes(feature)
    ).map((service) => service.id);
    const automatedTargetServices = SERVICE_DEFINITIONS.filter((service) =>
      service.runtime.accountWriteFeatures.includes(feature) || service.runtime.generatedImportFileFeatures.includes(feature)
    ).map((service) => service.id);
    return [feature, {
      sourceRead: metric(sourceServices.length, totalPlatforms, sourceServices),
      accountWrite: metric(accountWriteServices.length, totalPlatforms, accountWriteServices),
      automatedTarget: metric(automatedTargetServices.length, totalPlatforms, automatedTargetServices)
    }];
  })) as RuntimeSupportSummary['featureSlots']['byFeature'];

  const workflows = Object.fromEntries(([
    'direct-account', 'dedicated-file', 'metadata-recommendation', 'manual-mapping', 'restricted'
  ] satisfies RuntimeWorkflow[]).map((workflow) => {
    const services = SERVICE_DEFINITIONS.filter((service) => service.runtime.workflow === workflow).map((service) => service.id);
    return [workflow, metric(services.length, totalPlatforms, services)];
  })) as Record<RuntimeWorkflow, SupportMetric>;

  return {
    platforms: {
      selectable: metric(serviceIds.length, totalPlatforms, serviceIds),
      directAccount: metric(directAccount.length, totalPlatforms, directAccount),
      fullThreeFeatureDirect: metric(fullThreeFeatureDirect.length, totalPlatforms, fullThreeFeatureDirect),
      anyLocalSourcePath: metric(anyLocalSourcePath.length, totalPlatforms, anyLocalSourcePath),
      metadataOrRecommendations: metric(metadataOrRecommendations.length, totalPlatforms, metadataOrRecommendations),
      restricted: metric(restricted.length, totalPlatforms, restricted),
      allModelFeaturesDirect: metric(0, totalPlatforms, [])
    },
    featureFamilies: {
      executable: metric(EXECUTABLE_SYNC_FEATURES.length, MODEL_SYNC_FEATURES.length),
      supported: [...EXECUTABLE_SYNC_FEATURES],
      modelOnly: MODEL_SYNC_FEATURES.filter((feature) => !(EXECUTABLE_SYNC_FEATURES as readonly string[]).includes(feature))
    },
    featureSlots: {
      sourceRead: metric(sourceReadSlots, featureSlotTotal),
      accountWrite: metric(accountWriteSlots, featureSlotTotal),
      automatedTarget: metric(automatedTargetSlots, featureSlotTotal),
      byFeature
    },
    directions: {
      executable: metric(2, 2),
      supported: ['one-way', 'two-way'],
      missing: []
    },
    workflows
  };
}
