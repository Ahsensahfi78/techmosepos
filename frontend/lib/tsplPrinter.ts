/**
 * Send a TSPL job straight to a USB label printer, bypassing both the Windows
 * driver and Chrome's page size.
 *
 * A thermal label printer exposes a bulk OUT endpoint. Writing the TSPL bytes
 * to it is exactly what the printer's own software does, so the job is not
 * rasterised, not rescaled to A4, and the printer's own gap sensing applies.
 * This is the only path that guarantees the 76 x 100 mm box survives the trip
 * from the app to the paper.
 *
 * WebUSB requires a secure context (https or localhost) and a user gesture,
 * and the user has to pick the device once in the browser's own chooser.
 * When any of that is unavailable the caller falls back to the browser print
 * dialog / .tspl download.
 */

const STORAGE_KEY = "pos_printer_language";

export type PrinterLanguage = "tspl" | "browser";

/**
 * Minimal WebUSB surface.
 *
 * This project's TypeScript DOM lib predates WebUSB, so the handful of
 * members actually used are declared here rather than pulling in
 * `@types/w3c-web-usb` for one feature.
 */
interface UsbOutEndpoint {
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous" | "control";
  endpointNumber: number;
}

interface UsbAlternate {
  alternateSetting: number;
  endpoints: UsbOutEndpoint[];
}

interface UsbInterface {
  interfaceNumber: number;
  claimed: boolean;
  alternates: UsbAlternate[];
}

interface UsbConfiguration {
  interfaces: UsbInterface[];
}

interface UsbDevice {
  opened: boolean;
  productName?: string;
  configuration: UsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(
    interfaceNumber: number,
    alternateSetting: number,
  ): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
  ): Promise<{ status: string; bytesWritten?: number }>;
}

interface UsbNavigator {
  requestDevice(options: {
    filters: { vendorId?: number; productId?: number; class?: number }[];
  }): Promise<UsbDevice>;
}

function usbNavigator(): UsbNavigator | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { usb?: UsbNavigator }).usb ?? null;
}

export function isPrinterLanguage(value: unknown): value is PrinterLanguage {
  return value === "tspl" || value === "browser";
}

export function loadPrinterLanguage(): PrinterLanguage {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isPrinterLanguage(raw)) return raw;
  } catch {
    /* storage unavailable */
  }
  return "browser";
}

export function savePrinterLanguage(value: PrinterLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* storage unavailable */
  }
}

/** TSPL is plain ASCII; the printer's fonts and parser are single-byte. */
export function tsplToBytes(data: string): Uint8Array {
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const code = data.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x20;
  }
  return bytes;
}

export function isWebUsbSupported(): boolean {
  return usbNavigator() !== null;
}

export interface TsplSendResult {
  ok: boolean;
  message: string;
  printer?: string;
}

/**
 * Ask the user to pick a USB device and write the job to its first bulk OUT
 * endpoint. Never throws — the caller shows `message` either way.
 */
export async function sendTsplViaWebUsb(data: string): Promise<TsplSendResult> {
  const usb = usbNavigator();
  if (!usb) {
    return {
      ok: false,
      message:
        "WebUSB is not available in this browser. Use Edge or Chrome, over https.",
    };
  }

  let device: UsbDevice;
  try {
    device = await usb.requestDevice({ filters: [] });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotFoundError") {
      return { ok: false, message: "No printer selected." };
    }
    return { ok: false, message: `Could not open the printer picker: ${String(err)}` };
  }

  try {
    if (!device.opened) await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Printers put the bulk OUT endpoint on interface 0, alternate 0.
    const iface = device.configuration?.interfaces.find((i) =>
      i.alternates.some((alt) =>
        alt.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
      ),
    );
    if (!iface) {
      return {
        ok: false,
        message: `${device.productName || "The selected device"} has no bulk output — it is not a raw printer.`,
        printer: device.productName,
      };
    }

    const alt = iface.alternates.find((a) =>
      a.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
    )!;
    const endpoint = alt.endpoints.find(
      (ep) => ep.direction === "out" && ep.type === "bulk",
    )!;

    if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
    await device.selectAlternateInterface(
      iface.interfaceNumber,
      alt.alternateSetting,
    );

    const bytes = tsplToBytes(data);
    // WebUSB caps a single transfer; chunk it so a multi-label job still goes.
    const CHUNK = 16384;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      const result = await device.transferOut(endpoint.endpointNumber, chunk);
      if (result.status !== "ok") {
        return {
          ok: false,
          message: `Printer rejected the job (${result.status}).`,
          printer: device.productName,
        };
      }
    }

    return {
      ok: true,
      message: `Sent ${bytes.length} bytes to ${device.productName || "the printer"}.`,
      printer: device.productName,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not send to the printer: ${String(err)}`,
      printer: device.productName,
    };
  } finally {
    try {
      if (device.opened) await device.close();
    } catch {
      /* nothing useful to do */
    }
  }
}
