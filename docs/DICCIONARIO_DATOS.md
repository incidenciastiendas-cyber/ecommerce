# 📚 Diccionario de Datos — JANIS Data Lake (`datalake`)

> Mapeo de campos del data lake de JANIS (cliente **masonline**: Jumbo, Disco, Vea, Más Online).
> Motor: **ClickHouse**. 46 tablas, 805 campos.
> Pensado como referencia para construir la app vía API.

## ⚠️ Nota clave sobre la API vs. el Data Lake

Este diccionario describe el **data lake analítico** (lo que consultamos por SQL). La **API operativa de JANIS** que vas a usar para la app probablemente devuelva los mismos conceptos pero con **nombres anidados / camelCase** (ej. `order.shipping.deliveryWindow.start` en vez de `delivery_window_initial_date`). Usá este doc como **mapa semántico** (qué dato existe y qué significa) y cuando tengas la doc de la API la cruzamos campo a campo.

---

## 🔁 Campos comunes (presentes en casi todas las tablas)

Para no repetirlos en cada tabla, se definen una sola vez. Si una tabla los tiene, asumir este significado:

| Campo | Tipo | Significado |
|---|---|---|
| `client_code` | texto | Cliente del data lake (siempre `masonline`) |
| `date_created` | fecha/hora | Cuándo se creó el registro en JANIS |
| `date_modified` | fecha/hora | Cuándo se modificó por última vez en JANIS |
| `commerce_date_created` | fecha/hora | Fecha de creación en la plataforma de e-commerce (VTEX/Magento) |
| `sys_audit_created_at` | fecha/hora | Auditoría: cuándo entró el dato al data lake |
| `sys_audit_updated_at` | fecha/hora | Auditoría: cuándo se actualizó en el data lake |

**Leyenda de tipos:** `texto`=String · `texto(cat)`=LowCardinality (valores acotados, ideal para filtros) · `entero`=Int32 · `decimal`=Float64 · `$`=Decimal(38,2) (montos) · `sí/no`=Bool · `fecha/hora`=DateTime.

> En las tablas de abajo se **omiten** los campos comunes de auditoría para mayor claridad; asumí que están salvo que se diga lo contrario.

---

# 1) 🛒 PEDIDOS

## `orders` — Pedido (tabla central, 73 campos)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | ID del pedido en JANIS (clave) |
| `order_commerce_id` | texto | ID del pedido en la plataforma externa (VTEX, Magento) |
| `order_group_id` | texto | Agrupa varios pedidos de una misma compra |
| `order_group_commerce_id` | texto | ID del grupo de pedidos en la plataforma externa |
| `customer_id` | texto | ID del cliente |
| `seller_id` | texto | ID del vendedor (marketplace) |
| `sales_channel_id` | texto | Canal donde se hizo el pedido (web, app, marketplace) |
| `sales_channel_reference_id` | texto | Referencia externa del canal de venta |
| `seller_sales_channel_id` | texto | Canal de venta del seller (en pedidos de marketplace) |
| `seller_sales_channel_reference_id` | texto | Referencia externa del canal del seller |
| `address_commerce_id` | texto | ID de la dirección en la plataforma |
| `address_type` | texto | Tipo de dirección: envío / facturación / pickup |
| `address_country_code` | texto | País |
| `address_state` | texto | Provincia |
| `address_city` | texto | Ciudad |
| `address_neighborhood` | texto | Barrio |
| `address_postal_code` | texto | Código postal |
| `address_street_name` | texto | Calle |
| `address_street_number` | texto | Número |
| `address_latitude` | decimal | Latitud de la entrega |
| `address_longitude` | decimal | Longitud de la entrega |
| `skip_picking` | sí/no | Si true, el pedido saltea el proceso de picking |
| `external_payment_validation` | sí/no | Si true, el pago lo valida un sistema externo |
| `automatic_capture_post_picking` | sí/no | Si true, el pago se captura automáticamente tras el picking |
| `account_id` | texto | ID de cuenta |
| `platform_name` | texto(cat) | Plataforma de e-commerce (vtex, magento, shopify) |
| `status_code` | texto(cat) | **Estado del pedido** (ver valores abajo) |
| `total_amount` | $ | Monto final del pedido (con descuentos) |
| `original_amount` | $ | Monto antes de descuentos |
| `total_items_original_amount` | $ | Subtotal de ítems antes de descuentos |
| `total_items_amount` | $ | Subtotal de ítems final |
| `total_discounts_original_amount` | $ | Descuentos (original) |
| `total_discounts_amount` | $ | Descuentos (final) |
| `total_taxes_original_amount` | $ | Impuestos (original) |
| `total_taxes_amount` | $ | Impuestos (final) |
| `total_shipping_original_amount` | $ | Costo de envío (original) |
| `total_shipping_amount` | $ | Costo de envío (final) |
| `total_costs_original_amount` | $ | Costos (original) |
| `total_costs_amount` | $ | Costos (final) |
| `currency_code` | texto(cat) | Moneda (ISO 4217, ej. ARS) |
| `commerce_sequential_id` | texto | ID secuencial legible de la plataforma |
| `shipping_carrier_id` | texto | Transportista del envío |
| `shipping_address_commerce_id` | texto | Dirección de envío (ID plataforma) |
| `shipping_delivery_window_additional_price` | $ | Cargo extra por entrega programada/express |
| `shipping_price` | $ | Precio del envío |
| `shipping_sla_name` | texto | SLA del envío (Express, Standard) |
| `shipping_company_name` | texto | Empresa transportista |
| `shipping_polygon_name` | texto | Zona/polígono de entrega |
| `shipping_id` | texto | ID del envío |
| `shipping_status` | texto(cat) | Estado del envío |
| `shipping_type` | texto | Tipo de envío (delivery, pickup) |
| `shipping_carrier_ref_id` | texto | Referencia interna del transportista |
| `shipping_date_modified` | fecha/hora | Última modificación del envío |
| `shipping_delivery_id` | texto | Enlace a la entidad delivery del TMS |
| `shipping_dispatch_date` | fecha/hora | Fecha en que salió del depósito |
| `shipping_location_id` | texto | Ubicación del envío |
| `shipping_real_time_id` | texto | ID de tracking en tiempo real |
| `shipping_warehouse_id` | texto | Depósito de origen del envío |
| `is_npo` | sí/no | Si true, el pedido no fue operado en JANIS |
| `rescheduled_count` | entero | Veces que se reprogramó la entrega |
| `items_count` | entero | Cantidad de ítems |
| `packages_count` | entero | Cantidad de bultos |
| `delivered_on_time` | sí/no | Si se entregó a tiempo |
| `is_scheduled` | sí/no | Si la entrega es programada |
| `delivery_sla_start` | fecha/hora | Inicio del SLA de entrega |
| `delivery_sla_end` | fecha/hora | Fin del SLA de entrega (entrega prometida) |
| `lead_time_seconds` | entero | Segundos desde la creación hasta la entrega prometida |

**Valores de `status_code`:** `picking` (en preparación), `readyForInvoice` (listo para facturar), `needsRepacking` (re-empaque), `readyForDelivery` (listo para entrega), `pendingCandidatesConfirmation` (pendiente confirmar sustitutos), `delivered` (entregado), `notDelivered` (no entregado), `validatingPayments` (validando pago).

## `order_items` — Ítems del pedido (29)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido al que pertenece |
| `item_id` 🔑 | texto | ID único de la línea |
| `reference_id` | texto | Código de referencia del SKU |
| `product_commerce_id` | texto | ID del producto en la plataforma |
| `item_name` | texto | Nombre del producto |
| `purchased_price` | $ | Precio unitario final pagado |
| `purchased_list_price` | $ | Precio unitario de lista (sin descuentos) |
| `purchased_price_per_measurement_unit` | $ | Precio por kg/unidad (productos pesables) |
| `list_price_per_measurement_unit` | $ | Precio de lista por kg/unidad |
| `purchased_quantity` | $ | Cantidad pedida por el cliente |
| `selling_measurement_unit` | texto | Unidad de venta (kg, un, lt) |
| `selling_unit_multiplier` | $ | Multiplicador de conversión de unidad |
| `shipping_price` | $ | Costo de envío a nivel ítem |
| `is_picked` | sí/no | **Si true, el ítem fue pickeado** (clave para faltantes) |
| `brand_id` | texto | Marca |
| `ean_code` | texto | Código de barras |
| `sku_commerce_id` | texto | **SKU en la plataforma** (el "número de SKU" de tienda) |
| `location_id` | texto | Ubicación de fulfillment (la tienda) |
| `picking_point_id` | texto | Depósito/tienda donde se pickea |
| `picking_session_id` | texto | Enlace a `picking_session` |
| `category_uid` | texto | ID de la jerarquía de categoría |
| `is_removed` | sí/no | Si true, el ítem fue quitado del pedido durante el picking |
| `purchased_physical_quantity` | decimal | Cantidad física comprada |

## `order_item_product_groups` — Grupos/comportamientos de producto del ítem (32)
Define reglas de preparación por producto (umbrales de picking, si requiere lote/vencimiento/foto, etc.) y la configuración de código de barras.
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id`, `item_id` 🔑 | texto | Pedido + línea |
| `reference_id` | texto | Código de referencia del SKU |
| `product_commerce_id` | texto | ID del producto en la plataforma |
| `product_group_id` / `_reference_id` / `_name` / `_icon` | texto | Grupo de producto (id, referencia, nombre, ícono) |
| `behaviors_picking_lower_threshold` | entero | % mínimo aceptable a pickear |
| `behaviors_picking_upper_threshold` | entero | % máximo aceptable a pickear |
| `behaviors_require_batch` | sí/no | Requiere número de lote |
| `behaviors_require_expiration_date` | sí/no | Requiere fecha de vencimiento |
| `behaviors_auto_picking` | sí/no | Se pickea automáticamente |
| `behaviors_requires_preparation` | sí/no | Necesita preparación (ej. carnicería) |
| `behaviors_invoice_measurement_unit` | texto | Unidad para facturación |
| `behaviors_delivery_requires_photo` | sí/no | Requiere foto en la entrega |
| `behaviors_product_can_be_rotated` | texto | Si se permite rotación |
| `behaviors_candidate_type` | texto | Tipo de candidato de sustitución |
| `barcode_name` / `barcode_type` / `barcode_reference_id` / `barcode_id` | texto | Config de código de barras (formato EAN13, GS1, etc.) |
| `catalogation_reference_id_position_start` / `_end` | entero | Posición inicio/fin de la referencia dentro del barcode |
| `catalogation_complete_with_zero` | sí/no | Rellenar con ceros |
| `catalogation_use_verification_code` | sí/no | Validar dígito verificador |

## `order_payments` — Pagos del pedido (19)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido |
| `payment_id` | texto | ID del pago |
| `transaction_id` | texto | ID de transacción del gateway |
| `payment_group` | texto | Categoría (creditCard, debitCard, cash) |
| `payment_system_commerce_id` | texto | ID del medio de pago en la plataforma |
| `payment_system_name` | texto | Medio de pago (Visa, Mastercard, Cash) |
| `payment_amount` | $ | Monto total del pago (con intereses) |
| `amount_without_interests` | $ | Monto sin intereses |
| `installments` | entero | Cantidad de cuotas |
| `payment_status` | texto(cat) | Estado del pago |
| `is_online_payment` | sí/no | Pago online en el checkout |
| `is_online_payment_upon_delivery` | sí/no | Pago online cobrado en la entrega |
| `is_payment_upon_delivery` | sí/no | Pago contra entrega (COD) |

## `order_invoices` — Facturación (10)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido |
| `jef_id` | texto | ID de facturación electrónica JANIS (JEF) |
| `invoice_number` | texto | Número de factura fiscal |
| `invoice_value` | $ | Monto total facturado |

## `order_rma` — Devoluciones (9)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido |
| `rma_id` | texto | ID de la autorización de devolución |
| `rma_name` | texto | Motivo o descripción de la devolución |

## `order_steps` — Etapas del flujo del pedido (11)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido |
| `step_name` | texto | Etapa (picking, packing, shipping) |
| `step_status` | texto | Estado de la etapa |
| `step_date_start` | fecha/hora | Inicio de la etapa |
| `step_date_end` | fecha/hora | Fin de la etapa |

## `order_shippings` — Envío del pedido (28)
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id` 🔑 | texto | Pedido |
| `carrier_id` | texto | Transportista |
| `address_commerce_id` | texto | Dirección (ID plataforma) |
| `delivery_window_initial_date` | fecha/hora | **Inicio de la ventana de entrega prometida** |
| `delivery_window_final_date` | fecha/hora | **Fin de la ventana de entrega prometida** |
| `delivery_window_additional_price` | $ | Cargo extra por entrega express/programada |
| `delivery_estimate_date` | fecha/hora | Fecha estimada de entrega |
| `shipping_price` | $ | Precio del envío |
| `sla_name` | texto | SLA (Express, Standard) |
| `company_name` | texto | Empresa transportista |
| `is_pickup` | sí/no | Si el cliente retira en tienda |
| `polygon_name` | texto | Zona de entrega |
| `shipping_id` | texto | ID del envío |
| `status_code` | texto(cat) | Estado del envío |
| `type_name` | texto | Tipo de envío (delivery, pickup) |
| `carrier_ref_id` | texto | Referencia interna del transportista |
| `delivery_id` | texto | Enlace a la entidad delivery del TMS |
| `dispatch_date` | fecha/hora | Fecha en que salió del depósito |
| `location_id` / `real_time_id` / `warehouse_id` | texto | Ubicación / tracking en vivo / depósito |

---

# 2) 🧺 PICKING (preparación en tienda)

## `order_picking` — Enlace pedido↔picking (7)
| Campo | Tipo | Descripción |
|---|---|---|
| `picking_id` 🔑 | texto | ID del picking |
| `order_id` | texto | Pedido |
| `date_created` | fecha/hora | Fecha del picking |

## `picking_session` — Sesión de preparación (29)
| Campo | Tipo | Descripción |
|---|---|---|
| `picking_id` 🔑 | texto | ID de la sesión |
| `picking_display_id` | texto | ID legible de la sesión |
| `total_products` | entero | SKUs únicos a pickear |
| `total_items` | entero | Unidades totales a pickear |
| `complete_flag` | sí/no | Si se pickearon todos los ítems |
| `sorted_flag` | sí/no | Si se ordenaron por pedido |
| `status_code` | texto(cat) | Estado de la sesión |
| `is_ready_to_pick` | sí/no | Lista para empezar |
| `picking_point_id` | texto | Depósito/tienda |
| `picking_point_reference_id` | texto | Referencia externa del depósito |
| `wave_id` / `wave_display_id` | texto | Ola de picking (id / id legible) |
| `wave_date_start` / `wave_date_end` | fecha/hora | Inicio / fin de la ola |
| `skip_picking` | sí/no | Si se saltea el picking |
| `picker_id` | texto | Usuario del preparador |
| `start_picking_time` | fecha/hora | Cuándo empezó a preparar |
| `end_picking_time` | fecha/hora | Cuándo terminó |
| `total_items_missing` | entero | **Ítems no encontrados durante el picking** |
| `total_items_picked` | entero | Unidades pickeadas con éxito |
| `total_products_picked` | entero | SKUs únicos pickeados con éxito |
| `has_items_repicked` | sí/no | Si hubo ítems re-pickeados |
| `has_items_skipped` | sí/no | Si hubo ítems salteados |
| `has_items_candidate` | sí/no | Si hay sustitutos pendientes de confirmar |

## `order_item_picking_results` — Resultado de picking por ítem (29)
Lo que el picker efectivamente levantó (incluye sustitutos).
| Campo | Tipo | Descripción |
|---|---|---|
| `order_id`, `order_item_id` 🔑 | texto | Pedido + línea original |
| `order_item_product_commerce_id` | texto | Producto en la plataforma |
| `item_id` | texto | ID del ítem resultado |
| `ean_code` | texto | Código de barras escaneado |
| `sku_id` | texto | SKU |
| `ean_count` | entero | Cantidad de barcodes escaneados |
| `is_candidate` | sí/no | Si está pendiente de aprobación del cliente |
| `picker_id` | texto | Preparador |
| `price` | $ | Precio unitario al momento del picking |
| `reference_id` | texto | Código de referencia del SKU |
| `item_name` | texto | Nombre del producto |
| `batch` | texto | Número de lote |
| `expiration_date` | fecha/hora | Vencimiento |
| `is_substitute` | sí/no | **Si true, es un producto de reemplazo/sustitución** |
| `measurement_unit` / `unit_multiplier` | texto/$ | Unidad base y multiplicador |
| `price_per_measurement_unit` | $ | Precio por kg/unidad |
| `quantity_per_ean` | entero | Unidades por escaneo |
| `total_quantity` | $ | Cantidad total pickeada |
| `manufacturer_code` | texto | Código de fabricante |

## `order_item_picking_result_product_groups` — Reglas de producto en el resultado (31)
Misma estructura de `behaviors_*` / `barcode_*` / `catalogation_*` que `order_item_product_groups` (ver arriba), aplicada al resultado del picking.

## `item_picking_route` — Recorrido del picker por la tienda (18)
| Campo | Tipo | Descripción |
|---|---|---|
| `picking_id`, `picking_item_id`, `order_id`, `order_item_id` 🔑 | texto | Claves de enlace |
| `picking_quantity` | $ | Cantidad a pickear |
| `available_stock` | $ | Stock disponible al momento del picking |
| `position_available_stock` | $ | Stock en esa posición |
| `category_id` | texto | Categoría |
| `position_id` | texto | Posición en el WMS |
| `position_key` | texto | Código legible de posición |
| `position_schema` | texto | Jerarquía de posición (pasillo-estante-nivel) |
| `sku_id` | texto | SKU |
| `picking_sequence` | entero | Orden en que se debe pickear |

## `item_picking_time_tracking` — Cronómetro del picking por ítem (11)
| Campo | Tipo | Descripción |
|---|---|---|
| `picking_id`, `order_id`, `order_item_id`, `picking_item_id` 🔑 | texto | Claves |
| `time_tracking_type` | texto | **Tipo de evento**: `start`, `finish`, `pause`, `resume` |
| `time_tracking_time` | fecha/hora | **Timestamp del evento** (el "horario" de búsqueda del ítem) |

## `item_picking_additional_positions` — Posiciones extra de góndola (13)
| Campo | Tipo | Descripción |
|---|---|---|
| `picking_id`, `picking_item_id`, `order_id`, `order_item_id` 🔑 | texto | Claves |
| `position_available_stock` | $ | Stock en la posición |
| `position_id` / `position_key` / `position_schema` | texto | Posición WMS (id / código / jerarquía) |

---

# 3) 🚚 ENVÍOS (shipping)

## `delivery_shippings` — Envío a domicilio (48)
| Campo | Tipo | Descripción |
|---|---|---|
| `delivery_shipping_id` 🔑 | texto | ID del envío |
| `display_id` | texto | ID legible |
| `origin` | texto(cat) | Origen del registro (janis) |
| `carrier_id` | texto | Transportista (FK a `carriers`) |
| `type` | texto(cat) | Tipo (delivery, pickup) |
| `status` | texto(cat) | Estado actual del envío |
| `sender_company_name` / `sender_fullname` | texto | Remitente (empresa / nombre) |
| `sender_warehouse_id` / `_reference_id` / `sender_location_id` | texto | Depósito y ubicación de origen |
| `pickup_*` (city, state, country, postal_code, neighborhood, longitude, latitude, location_id, location_reference_id) | varios | **Punto de retiro** (origen) |
| `dropoff_*` (city, state, country, postal_code, neighborhood, longitude, latitude) | varios | **Punto de entrega** (destino) |
| `schedule_source_longitude/latitude` | decimal | Coordenadas de origen programado |
| `schedule_target_longitude/latitude` | decimal | Coordenadas de destino programado |
| `schedule_start` / `schedule_end` | fecha/hora | Ventana de entrega programada (inicio/fin) |
| `tracking_real_time_id` | texto | Sesión de tracking en tiempo real |
| `package_pending` / `route_pending` | sí/no | Bulto / ruta pendiente |
| `wait_for_ready_for_pickup` / `ready_for_pickup` | sí/no | Espera / listo para retiro |
| `is_scheduled` | sí/no | Si es programado |
| `failed_deliveries_max_attempts` / `_attempts` | entero | Máximo de intentos / intentos fallidos |
| `product_quantity` / `package_quantity` | entero | Cantidad de productos / bultos |

## `delivery_shipping_orders` — Envío ↔ pedidos (12)
| Campo | Tipo | Descripción |
|---|---|---|
| `delivery_shipping_id` 🔑 | texto | Envío |
| `order_id` / `order_commerce_id` / `order_commerce_sequential_id` | texto | Pedido (IDs interno y externos) |
| `items_quantity` | entero | Cantidad de ítems |
| `total_amount` | $ | Monto total |
| `is_online_payment_upon_delivery` | sí/no | Pago online en la entrega |

## `delivery_shipping_tracking_status` — Estados de seguimiento (8)
| Campo | Tipo | Descripción |
|---|---|---|
| `delivery_shipping_id` 🔑 | texto | Envío |
| `status_name` | texto(cat) | Nombre del estado |
| `status_date` | fecha/hora | Cuándo se alcanzó el estado |

## `shipping_types` — Tipos de envío (15)
| Campo | Tipo | Descripción |
|---|---|---|
| `shipping_type_id` 🔑 | texto | ID del tipo |
| `reference_id` | texto | Referencia externa |
| `origin` | texto(cat) | Origen (janis, custom) |
| `code` | texto(cat) | Código (express_delivery, standard) |
| `title` | texto | Nombre visible |
| `allow_routes` | sí/no | Si puede asignarse a rutas |
| `allow_packages` | sí/no | Si soporta bultos |
| `allow_windows` | sí/no | Si soporta ventanas de entrega |
| `need_route` | sí/no | Si requiere ruta |
| `status` | texto(cat) | Estado (active/inactive) |

## `delivery_time_slots` — Franjas horarias de entrega (40)
| Campo | Tipo | Descripción |
|---|---|---|
| `time_slot_id` 🔑 | texto | ID de la franja |
| `display_id` | texto | ID legible |
| `carrier_id` | texto | Transportista (FK) |
| `date_start` / `date_end` | fecha/hora | Ventana de entrega (inicio/fin) |
| `closing_time` | fecha/hora | Último momento que acepta nuevos envíos |
| `capacity_max_shipping_quantity_default/value/effective` | entero | Capacidad de envíos (default / override / aplicado) |
| `capacity_max_package_quantity_default/value/effective` | entero | Capacidad de bultos |
| `capacity_max_product_quantity_default/value/effective` | entero | Capacidad de productos |
| `delivery_cost` | entero | Costo de envío en la franja |
| `status` | texto(cat) | Estado (pending/open/closed) |
| `totals_shippings_count/pending/in_progress/delivered/not_delivered/canceled/with_error` | entero | Totales de envíos por estado |
| `totals_routes_count/pending/in_progress/finished` | entero | Totales de rutas por estado |
| `totals_packages_count` / `totals_products_count` | entero | Totales de bultos / productos |
| `lock_id` / `lock_reason` / `is_locked` / `lock_comment` / `lock_date` | varios | Bloqueo de la franja (id, motivo, flag, comentario, fecha) |

---

# 4) 🗺️ RUTEO Y ENTREGA (last mile)

## `routes` — Ruta del repartidor (20)
| Campo | Tipo | Descripción |
|---|---|---|
| `route_id` 🔑 | texto | ID de la ruta |
| `display_id` | texto | ID legible (ej. 250702-P7BEUY) |
| `schedule_start` / `schedule_end` | fecha/hora | Inicio / fin programado |
| `distance_expected` | decimal | Distancia esperada (km) |
| `distance_actual` | decimal | Distancia real recorrida (km) |
| `duration_scheduled` | entero | Duración programada (seg) |
| `duration_expected` | entero | Duración esperada (seg) |
| `route_taken_type` | texto(cat) | Tipo de envelope de la ruta tomada |
| `has_online_payment_upon_delivery` | sí/no | Tiene pago online contra entrega |
| `has_payment_upon_delivery` | sí/no | Tiene pago efectivo/POS contra entrega |
| `company_id` | texto | Operador logístico (3PL) |
| `driver_id` | texto | Repartidor asignado |
| `auto_schedule` | sí/no | Si fue auto-programada |
| `status` | texto(cat) | Estado de la ruta |

## `route_stops` — Paradas de la ruta (11)
| Campo | Tipo | Descripción |
|---|---|---|
| `route_id`, `stop_id` 🔑 | texto | Ruta + parada (UUID) |
| `stop_kind` | texto(cat) | Tipo de parada: `warehouse` (depósito) / `customer` (cliente) |
| `stop_warehouse_id` | texto | Depósito (solo paradas de depósito) |
| `stop_longitude` / `stop_latitude` | decimal | Coordenadas de la parada |

## `route_stop_actions` — Acciones en cada parada (10)
| Campo | Tipo | Descripción |
|---|---|---|
| `route_id`, `stop_id` 🔑 | texto | Ruta + parada |
| `action_type` | texto(cat) | Acción: `pickup` (recolección) / `dropoff` (entrega) |
| `action_shipping_id` | texto | Envío sobre el que opera la acción |
| `action_status` | texto(cat) | Estado de la acción (pending/done) |

## `route_taken` — Traza GPS recorrida (10)
| Campo | Tipo | Descripción |
|---|---|---|
| `route_id` 🔑 | texto | Ruta |
| `point_latitude` / `point_longitude` | decimal | Coordenada reportada |
| `point_date` | fecha/hora | Timestamp del punto |
| `point_index` | entero | Índice secuencial del punto en la ruta |

## `route_orders` / `route_shippings` / `route_carriers` / `route_warehouses` — Enlaces de la ruta (7 c/u)
Tablas puente que asocian la ruta con: pedidos (`order_id`), envíos (`shipping_id`), transportistas (`carrier_id`) y depósitos (`warehouse_id`) respectivamente. Todas comparten `route_id` 🔑.

---

# 5) 🚐👷 FLOTA Y PERSONAL

## `drivers` — Repartidores (12)
| Campo | Tipo | Descripción |
|---|---|---|
| `driver_id` 🔑 | texto | ID del repartidor |
| `employee_id` | texto | ID de empleado |
| `profile_id` | texto | Perfil/rol asignado |
| `status` | texto(cat) | Estado (active/inactive) |
| `user_id` / `user_status` | texto | Usuario y su estado |
| `has_access_to_all_locations` | sí/no | Si accede a todos los depósitos |

## `driver_warehouses` — Repartidor ↔ depósito (7)
`driver_id` 🔑 + `warehouse_id`: en qué depósitos opera cada repartidor.

## `vehicles` — Vehículos (16)
| Campo | Tipo | Descripción |
|---|---|---|
| `vehicle_id` 🔑 | texto | ID del vehículo (TMS) |
| `reference_id` | texto | Referencia externa |
| `company_id` | texto | Operador logístico |
| `vehicle_type_id` | texto | FK a `vehicle_types` |
| `vehicle_name` | texto | Nombre |
| `plate` | texto | Patente |
| `brand` / `model` / `vehicle_year` | varios | Marca / modelo / año |
| `capacity` | entero | Capacidad de carga |
| `status` | texto(cat) | Estado |

## `vehicle_types` — Tipos de vehículo (17)
| Campo | Tipo | Descripción |
|---|---|---|
| `vehicle_type_id` 🔑 | texto | ID del tipo |
| `reference_id` | texto | Referencia externa |
| `company_id` | texto | Operador logístico |
| `vehicle_type_name` | texto | Nombre (Automovil, Camioneta) |
| `type` | texto(cat) | Categoría (car, truck, motorcycle) |
| `origin` / `status` | texto(cat) | Origen / estado |
| `max_distance` | entero | Distancia máx que cubre |
| `max_product_quantity` | entero | Máx productos por viaje |
| `max_shipping_quantity` | entero | Máx envíos por viaje |
| `max_volume` / `max_weight` | entero | Volumen / peso máximo de carga |

## `carriers` — Transportistas/operadores (27)
| Campo | Tipo | Descripción |
|---|---|---|
| `carrier_id` 🔑 | texto | ID del transportista (Mongo ObjectId) |
| `reference_id` | texto | Referencia externa |
| `origin` | texto(cat) | Origen (janis, custom) |
| `carrier_name` / `description` | texto | Nombre / descripción |
| `shipping_type_id` / `shipping_type` | texto | Tipo de envío (FK + label) |
| `generate_route` | sí/no | Si dispara generación de ruta |
| `status` | texto(cat) | Estado (active/inactive) |
| `min_fulfillment_time` | entero | Tiempo mínimo de fulfillment |
| `coverage_area_type` | texto(cat) | Tipo de cobertura (postalCode, polygon) |
| `is_external` / `is_internal` | sí/no | Externo (3PL) / interno |
| `company_id` | texto | Operador logístico |
| `default_extra_delivery_cost` | entero | Costo extra de envío por defecto |
| `default_package_quantity` | entero | Máx bultos por envío |
| `default_product_quantity` | entero | Máx productos por envío |
| `default_shipping_quantity` | entero | Máx envíos por viaje |
| `needs_automatic_routing` | sí/no | Requiere ruteo automático |
| `pre_dispatch_max_time` / `pre_dispatch_time` | entero | Tiempo máx / por defecto en pre-despacho |
| `require_photo_on_delivery` | texto(cat) | Requisito de foto en entrega |

## `carrier_locations` — Cobertura del transportista (7)
`carrier_id` 🔑 + `location_id`: zonas/ubicaciones que cubre cada transportista.

---

# 6) 🏬 CATÁLOGO E INVENTARIO

## `products` — Productos (17)
| Campo | Tipo | Descripción |
|---|---|---|
| `product_id` 🔑 | texto | ID del producto |
| `name` / `title` | texto | Nombre / título |
| `reference_id` | texto | Referencia externa |
| `brand_id` | texto | Marca |
| `category_id` | texto | Categoría |
| `slug` | texto | Slug (URL) |
| `is_new` | sí/no | Si es nuevo |
| `status` | texto | Estado |
| `tax_code` | texto | Código impositivo |
| `short_description` | texto | Descripción corta |
| `commerce_id` | texto | ID en la plataforma |

## `skus` — SKUs (28)
| Campo | Tipo | Descripción |
|---|---|---|
| `sku_id` 🔑 | texto | ID del SKU |
| `reference_id` | texto | Referencia externa |
| `selling_unit_multiplier` | entero | Multiplicador de unidad de venta |
| `modal_type` | texto | Tipo modal |
| `normalized_name` | texto | Nombre normalizado |
| `selling_measurement_unit` / `measurement_unit` | texto | Unidad de venta / base |
| `manufacturer_code` | texto | Código de fabricante |
| `commercial_condition_id` | texto | Condición comercial |
| `commerce_id` | texto | ID en la plataforma |
| `release_date` | fecha/hora | Fecha de alta |
| `measures_height/width/depth/weight` | decimal | Medidas del producto |
| `package_measures_height/width/depth/weight` | decimal | Medidas del empaque |
| `is_new` / `status` | varios | Nuevo / estado |

## `sku_eans` — Códigos de barra del SKU (8)
`sku_id` 🔑 + `sku_reference_id` + `ean_code` + `product_id`: relación SKU ↔ EAN.

## `categories` — Categorías (5)
`category_commerce_id` 🔑 + `category_name`: catálogo de categorías.

## `item_categories` — Jerarquía de categorías del ítem (6)
| Campo | Tipo | Descripción |
|---|---|---|
| `category_uid` 🔑 | texto | ID único de la jerarquía completa |
| `category_commerce_id` | texto | Categoría en la plataforma |
| `category_sequence` | entero | Nivel de profundidad (1=raíz) |

## `prices` — Precios (13)
| Campo | Tipo | Descripción |
|---|---|---|
| `price_id` 🔑 | texto | ID del precio |
| `price` | $ | Precio |
| `min_quantity` | entero | Cantidad mínima |
| `sku` | texto | SKU |
| `price_sheet` | texto | Lista de precios |
| `status` / `variation` / `processing` | varios | Estado / variación / en proceso |

## `stock` — Inventario (15)
| Campo | Tipo | Descripción |
|---|---|---|
| `stock_id` 🔑 | texto | ID del registro de stock |
| `stock` | entero | Stock total |
| `available_stock` | entero | Stock disponible |
| `infinite_stock` | sí/no | Stock infinito |
| `previous_stock` | entero | Stock anterior |
| `in_transit` | entero | En tránsito |
| `status` | texto | Estado |
| `update_date` | fecha/hora | Última actualización del stock |
| `sku_id` | texto | SKU (FK) |
| `warehouse_id` | texto | Depósito (FK) |

---

# 7) 🏢 DATOS MAESTROS

## `warehouses` — Depósitos / tiendas (18)
| Campo | Tipo | Descripción |
|---|---|---|
| `warehouse_id` 🔑 | texto | ID del depósito |
| `warehouse_name` | texto | Nombre |
| `location_id` | texto | Ubicación (FK a `locations`) |
| `reference_id` | texto | Código de tienda |
| `status` | texto(cat) | Estado (active/inactive) |
| `longitude` / `latitude` | decimal | Coordenadas |
| `timezone` | texto | Zona horaria (IANA) |
| `distribution_priority` | entero | Prioridad de distribución |
| `external_distribution` | sí/no | Distribución externa |
| `warehouse_group` | texto | Grupo de depósitos |
| `movements_requires_user_validation` | sí/no | Si los movimientos requieren validación |
| `picking_sales_channel_id` | texto | Canal de venta usado para picking |

> ⚠️ **Ojo:** un `location_id` (tienda física) tiene **varios** `warehouses` (Inv-Full, WM-PICKUP, WM-RT, puntos de pickup). Para el nombre de tienda usá `locations.location_name`, que es 1:1.

## `locations` — Ubicaciones / sucursales (15)
| Campo | Tipo | Descripción |
|---|---|---|
| `location_id` 🔑 | texto | ID de la ubicación |
| `location_name` | texto | **Nombre de la sucursal** (ej. "Sucursal Tucuman 1020") |
| `reference_id` | texto | **Código de tienda** (ej. 1020) |
| `status` | texto(cat) | Estado (active/inactive) |
| `location_longitude` / `location_latitude` | decimal | Coordenadas |
| `company_id` | texto | Operador logístico |
| `address_country` / `address_state` / `address_city` | varios | País / provincia / ciudad |

## `companies` — Empresas / operadores logísticos (16)
| Campo | Tipo | Descripción |
|---|---|---|
| `company_id` 🔑 | texto | ID de la empresa |
| `reference_id` | texto | Referencia externa |
| `origin` | texto(cat) | Origen (janis, custom) |
| `company_name` | texto | Nombre |
| `integ` | texto(cat) | Código de integración (pax, jadlog) |
| `label_generation` | texto(cat) | Modo de generación de etiqueta (core, external) |
| `complements_origin_name` | texto | Nombre de origen de complementos |
| `use_package` | sí/no | Si los envíos usan bultos |
| `wait_for_ready_for_pickup` | sí/no | Espera "listo para retiro" |
| `max_failed_deliveries` | entero | Máx intentos de entrega fallidos |
| `status` | texto(cat) | Estado (active/inactive) |

---

# 8) ⏱️ REGISTRO DE TRABAJO

## `work_logs` — Jornadas / actividades del personal (14)
| Campo | Tipo | Descripción |
|---|---|---|
| `work_log_id` 🔑 | texto | ID de la entrada |
| `user_id` | texto | Usuario al que pertenece |
| `shift_id` | texto | Turno |
| `work_log_type_id` | texto | FK a `work_log_types` |
| `work_log_type_name` / `work_log_type_reference_id` | texto | Tipo (desnormalizado) |
| `start_date` / `end_date` | fecha/hora | Inicio / fin de la sesión |
| `status` | texto(cat) | Estado (pending, in_progress, finished) |

## `work_log_types` — Tipos de registro de trabajo (13)
| Campo | Tipo | Descripción |
|---|---|---|
| `work_log_type_id` 🔑 | texto | ID del tipo |
| `reference_id` | texto | Referencia externa (default-picking-work) |
| `work_log_type_name` / `description` | texto | Nombre / descripción |
| `type` | texto(cat) | Categoría (work, break, training) |
| `is_internal` | sí/no | Si es del sistema (true) o del cliente (false) |
| `can_be_updated` | sí/no | Si se puede editar tras crearlo |
| `status` | texto(cat) | Estado (active/inactive) |

---

## 🔗 Mapa de relaciones (claves para JOINs)

```
orders (order_id)
 ├─ order_items (order_id) ──── item_id ── item_picking_time_tracking (order_item_id)
 │                          └── sku_commerce_id   order_item_picking_results (order_item_id)
 ├─ order_shippings (order_id) ── carrier_id ── carriers
 ├─ order_payments / order_invoices / order_rma / order_steps (order_id)
 ├─ order_picking (order_id) ── picking_id ── picking_session
 └─ location_id ── locations (location_id) ── reference_id (código de tienda)
                    └─ warehouses (location_id, 1→N)

routes (route_id)
 ├─ route_stops (route_id, stop_id) ── route_stop_actions (stop_id)
 ├─ route_orders / route_shippings / route_carriers / route_warehouses (route_id)
 ├─ route_taken (route_id) [traza GPS]
 └─ driver_id ── drivers ── driver_warehouses ── warehouses

skus (sku_id) ── sku_eans (sku_id) / stock (sku_id, warehouse_id) / prices (sku)
products (product_id) ── categories / item_categories
```
