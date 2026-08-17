import { useRef, useState, type FormEvent } from "react";
import { FormField } from "@/components/auth/FormField";
import { CATEGORIES } from "@/constants/categories";
import { ALLOWED_IMAGE_TYPES } from "@/constants/uploads";
import { createProduct } from "@/services/productsService";
import { uploadProductImage } from "@/services/uploadsService";
import { productFormSchema, validateImageFile } from "../productFormSchema";

interface FieldErrors {
  name?: string;
  categoryId?: string;
  price?: string;
  image?: string;
}

interface CreatedProduct {
  name: string;
  imageUrl: string;
}

export function CreateProductForm() {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>(CATEGORIES[0].id);
  // El precio se guarda como string, no como número: es lo que devuelve un
  // <input> incluso cuando su type es "number". Guardarlo ya convertido
  // obligaría a decidir qué hacer con el campo vacío en cada tecla.
  const [price, setPrice] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [createdProduct, setCreatedProduct] = useState<CreatedProduct | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mismo cerrojo que en el checkout: el estado se actualiza recién en el
  // re-render, el ref en el acto. Acá importa todavía más — un doble envío
  // subiría la imagen dos veces al bucket y crearía el producto duplicado.
  const isSubmittingRef = useRef(false);

  function resetForm(): void {
    setName("");
    setCategoryId(CATEGORIES[0].id);
    setPrice("");
    setImageFile(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // Sin esto el navegador recarga la página entera al enviar el formulario,
    // que es su comportamiento por defecto desde antes de que existiera React.
    event.preventDefault();

    if (isSubmittingRef.current) {
      return;
    }

    setFormError(null);
    // También se limpia la confirmación anterior. Sin esto, si el segundo alta
    // falla, el usuario ve al mismo tiempo el bloque de éxito del producto
    // anterior y el cartel de error del nuevo — dos mensajes que se contradicen.
    setCreatedProduct(null);

    // --- Validación en el navegador ---
    // Es de conveniencia: le ahorra al usuario un viaje al servidor para que le
    // digan lo que ya se sabe acá. La validación que cuenta está en la Vercel
    // Function y en las reglas de Firestore.
    const parsedFields = productFormSchema.safeParse({
      name,
      categoryId,
      price: price === "" ? Number.NaN : Number(price),
    });
    const imageError = validateImageFile(imageFile);

    if (!parsedFields.success || imageError !== null) {
      const errors: FieldErrors = {};

      if (!parsedFields.success) {
        for (const issue of parsedFields.error.issues) {
          const field = issue.path[0];
          // Solo el PRIMER error de cada campo: mostrar tres mensajes juntos
          // sobre el mismo input abruma en vez de ayudar.
          if (typeof field === "string" && !(field in errors)) {
            errors[field as keyof FieldErrors] = issue.message;
          }
        }
      }

      if (imageError !== null) {
        errors.image = imageError;
      }

      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      // Orden deliberado: primero la imagen, después el producto.
      //
      // Si fuera al revés y la subida fallara, quedaría un producto en el
      // catálogo apuntando a una imagen que no existe — visible para todos los
      // clientes y sin forma automática de detectarlo. Al revés, lo peor que
      // puede pasar es una imagen huérfana en el bucket: invisible, inofensiva y
      // barata de limpiar después.
      // "imageFile" no es null acá: validateImageFile ya devolvió null, y eso
      // solo ocurre cuando hay archivo.
      const imageUrl = await uploadProductImage(imageFile as File);

      await createProduct({
        name: parsedFields.data.name,
        categoryId: parsedFields.data.categoryId,
        price: parsedFields.data.price,
        imageUrl,
      });

      // Efectos del éxito dentro del try, después del await: si algo falla, el
      // formulario conserva lo que el admin había cargado y puede reintentar sin
      // volver a escribir todo.
      setCreatedProduct({ name: parsedFields.data.name, imageUrl });
      resetForm();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No pudimos crear el producto. Intentá de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  return (
    <form className="create-product-form" onSubmit={handleSubmit} noValidate>
      <h2>Nuevo producto</h2>

      <FormField
        id="product-name"
        label="Nombre"
        type="text"
        value={name}
        onChange={setName}
        error={fieldErrors.name}
        disabled={isSubmitting}
      />

      <div className="form-field">
        <label htmlFor="product-category" className="form-field__label">
          Categoría
        </label>
        <select
          id="product-category"
          className="form-field__input"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          disabled={isSubmitting}
        >
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      <FormField
        id="product-price"
        label="Precio"
        type="number"
        value={price}
        onChange={setPrice}
        error={fieldErrors.price}
        disabled={isSubmitting}
        // step="0.01": las flechitas del input avanzan de a un centavo y el
        // navegador marca en rojo un valor con más decimales. Es una pista
        // visual que llega ANTES de enviar; quien escribe el precio a mano se
        // la saltea, y para eso está la regla del schema.
        step="0.01"
      />

      <div className="form-field">
        <label htmlFor="product-image" className="form-field__label">
          Imagen
        </label>
        <input
          id="product-image"
          type="file"
          className="form-field__input"
          // "accept" filtra lo que muestra el selector de archivos del sistema.
          // Es comodidad, no seguridad: se puede elegir "todos los archivos" y
          // saltearlo. Por eso el tipo se vuelve a validar en validateImageFile
          // y, sobre todo, en el servidor.
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          disabled={isSubmitting}
          aria-invalid={Boolean(fieldErrors.image)}
          aria-describedby={fieldErrors.image ? "product-image-error" : undefined}
          onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
        />
        {fieldErrors.image && (
          <span id="product-image-error" role="alert" className="form-field__error">
            {fieldErrors.image}
          </span>
        )}
      </div>

      {formError && (
        <p className="create-product-form__error" role="alert">
          {formError}
        </p>
      )}

      <button type="submit" className="create-product-form__submit" disabled={isSubmitting}>
        {isSubmitting ? "Creando producto..." : "Crear producto"}
      </button>

      {createdProduct && (
        <div className="create-product-form__success" role="status">
          <p>El producto «{createdProduct.name}» se creó correctamente.</p>
          {/*
            El alt describe la imagen en su contexto. No dice "imagen de..."
            porque el lector de pantalla ya anuncia que es una imagen: repetirlo
            sería como leer "link link".
          */}
          <img
            src={createdProduct.imageUrl}
            alt={createdProduct.name}
            className="create-product-form__preview"
          />
        </div>
      )}
    </form>
  );
}
