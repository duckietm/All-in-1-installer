"use client";
import { useEffect, useState } from "react";
import { createLatestRequest } from "./latest-request";
export function useLatestRequest() {
	const [requests] = useState(createLatestRequest);
	useEffect(() => () => requests.cancel(), [requests]);
	return requests;
}
