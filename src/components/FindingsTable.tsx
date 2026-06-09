import type { VerificationFinding } from '../types';
import { StatusBadge } from './StatusBadge';

export function FindingsTable({ findings }: { findings: VerificationFinding[] }) {
  return (
    <div className="findings-table-wrap">
      <table className="findings-table">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Status</th>
            <th scope="col">Confidence</th>
            <th scope="col">Label evidence</th>
            <th scope="col">Next action</th>
          </tr>
        </thead>
        <tbody>
          {findings.length ? (
            findings.map((finding) => (
              <tr key={finding.id}>
                <td>
                  <strong>{finding.label}</strong>
                  <span className="finding-expected">{finding.expected}</span>
                </td>
                <td>
                  <StatusBadge status={finding.status} compact />
                </td>
                <td>{finding.confidence}%</td>
                <td>
                  {finding.evidence}
                  {finding.details?.length ? (
                    <ul className="finding-details">
                      {finding.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td>{finding.recommendation}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="empty-row">
                Run OCR or verify extracted text.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
