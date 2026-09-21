"""
EcoTwin ML package.

  simulator            - physics-inspired building telemetry generator (the
                         stand-in for a real IoT/BMS feed)
  features             - shared feature engineering
  expected_consumption - Random Forest baseline / expected-load model
  anomaly_detection    - Isolation Forest + robust residual detector
  root_cause           - transparent rule engine
  recommendations      - evidence-based recommendation templates
  savings              - IPMVP Option C measurement & verification
"""
__all__ = [
    "simulator",
    "features",
    "expected_consumption",
    "anomaly_detection",
    "root_cause",
    "recommendations",
    "savings",
]
