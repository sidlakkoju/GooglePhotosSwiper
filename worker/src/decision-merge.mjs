export function decisionWins(existing,incoming,existingTime,incomingTime) {
 return `(SELECT current_decision IS NULL AND next_timestamp >= COALESCE(prior_timestamp,0) OR (current_decision != 'remove' OR incoming_decision = 'remove') AND (incoming_decision = 'remove' AND current_decision = 'keep' OR next_timestamp >= COALESCE(prior_timestamp,0)) FROM (SELECT ${existing} AS current_decision, ${incoming} AS incoming_decision, ${existingTime} AS prior_timestamp, ${incomingTime} AS next_timestamp))`;
}
