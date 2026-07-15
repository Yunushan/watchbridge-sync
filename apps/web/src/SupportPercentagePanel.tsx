import React from 'react';
import { getRuntimeSupportSummary, type SupportMetric } from '@watchbridge/core';

interface MetricProps {
  label: string;
  metric: SupportMetric;
  detail: string;
  gapLabel?: string;
}

function PercentageMetric({ label, metric, detail, gapLabel = 'missing' }: MetricProps) {
  return <div className="support-metric">
    <dt>{label}</dt>
    <dd className="support-value">{metric.percent}%</dd>
    <dd>{metric.supported} / {metric.total} {detail}</dd>
    <dd className="support-gap">{metric.missingPercent}% {gapLabel}</dd>
  </div>;
}

export function SupportPercentagePanel() {
  const summary = getRuntimeSupportSummary();
  const featureLabels = {
    ratings: 'Ratings',
    watched: 'Watched / progress',
    watchlist: 'Watchlist'
  } as const;

  return <section className="card support-panel">
    <div className="support-heading">
      <div>
        <p className="eyebrow">Current repository coverage</p>
        <h2>Support percentages</h2>
      </div>
      <span className="local-badge">Computed locally</span>
    </div>
    <p>Being selectable means a platform can be planned or handled through its documented workflow. It does not mean every platform has direct account automation.</p>
    <dl className="support-grid">
      <PercentageMetric label="Selectable platforms" metric={summary.platforms.selectable} detail="platforms" gapLabel="not selectable" />
      <PercentageMetric label="Direct-account platforms" metric={summary.platforms.directAccount} detail="platforms" gapLabel="without direct account sync" />
      <PercentageMetric label="Registered three-feature direct methods" metric={summary.platforms.fullThreeFeatureDirect} detail="platforms" gapLabel="without all three registered account method families" />
      <PercentageMetric label="Readable source feature slots" metric={summary.featureSlots.sourceRead} detail="rating/watched/watchlist slots" gapLabel="source slots missing" />
      <PercentageMetric label="Verified account-write feature slots" metric={summary.featureSlots.accountWrite} detail="rating/watched/watchlist slots" gapLabel="account-write slots missing" />
      <PercentageMetric label="Automated target feature slots" metric={summary.featureSlots.automatedTarget} detail="rating/watched/watchlist slots" gapLabel="target slots missing" />
    </dl>
    <div className="support-table-wrap">
      <table className="support-feature-table">
        <caption>Coverage by executable feature</caption>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Readable source</th>
            <th scope="col">Account write</th>
            <th scope="col">Automated target</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(summary.featureSlots.byFeature).map(([feature, metrics]) => <tr key={feature}>
            <th scope="row">{featureLabels[feature as keyof typeof featureLabels]}</th>
            <td>{metrics.sourceRead.supported}/{metrics.sourceRead.total} ({metrics.sourceRead.percent}%)</td>
            <td>{metrics.accountWrite.supported}/{metrics.accountWrite.total} ({metrics.accountWrite.percent}%)</td>
            <td>{metrics.automatedTarget.supported}/{metrics.automatedTarget.total} ({metrics.automatedTarget.percent}%)</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className="support-footnote">The automated-target denominator is the live platform catalog × 3 executable data families. Registered methods do not imply universal pair, identifier, or field-fidelity compatibility. Reviews, following, followers, and full repeated-play event history are not counted as shipped execution; one-way and capability-gated two-way executor modes are shipped.</p>
  </section>;
}
