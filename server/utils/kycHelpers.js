// Shared helpers for the Full Loan Application / KYC flow.

// Copy of the member's bio-data at the moment of verification, so the
// administrator reviews exactly what was on file when the member applied.
export function buildApplicantDetails(membership) {
  return {
    fullName: membership?.fullName || "",
    phone: membership?.phone || "",
    email: membership?.email || "",
    address: membership?.address || "",
    dob: membership?.dob || "",
    gender: membership?.gender || "",
    maritalStatus: membership?.maritalStatus || "",
    occupation: membership?.occupation || "",
    employmentStatus: membership?.employmentStatus || "",
    stateOfOrigin: membership?.stateOfOrigin || "",
    lga: membership?.lga || "",
    kinName: membership?.kinName || "",
    kinPhone: membership?.kinPhone || "",
    kinRelationship: membership?.kinRelationship || "",
    kinAddress: membership?.kinAddress || "",
  };
}

// True once every Dojah check that the administrator relies on has passed.
export function isVerificationComplete(application) {
  return (
    application?.providerVerificationStatus === "completed" &&
    application?.bvnVerificationStatus === "verified" &&
    application?.faceVerificationStatus === "verified"
  );
}

// What a member is allowed to see about their own application. The audit
// snapshot, BVN hash and reviewer identity stay on the server.
export function safeApplication(application) {
  if (!application) return null;
  const value = application.toObject ? application.toObject() : { ...application };

  // A member may ask the server to re-read Dojah's result while the attempt is
  // unfinished, or was closed automatically (not by an administrator).
  value.canRecheck = Boolean(
    value.verificationReference &&
      (value.status === "draft" || (value.status === "rejected" && !value.reviewedBy))
  );

  delete value.bvn;
  delete value.bvnHash;
  delete value.verificationSnapshot;
  delete value.reviewedBy;
  delete value.approvedWithMismatch;
  return value;
}
