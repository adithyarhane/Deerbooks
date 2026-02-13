import bookModel from "../models/bookModel.js";
import orderModel from "../models/orderModel.js";
import reviewModel from "../models/reviewModel.js";

export const addReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookId } = req.params;
    const { rating, comment } = req.body;

    // validate raing
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 5",
      });
    }

    // check book exists or active
    const book = await bookModel.findOne({
      _id: bookId,
      isActive: true,
    });

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found or inactive",
      });
    }

    // prevent duplicate review
    const existingReview = await reviewModel.findOne({
      book: bookId,
      user: userId,
      isActive: true,
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this book",
      });
    }

    // check verified purchase
    let isVerifiedPurchase = false;

    const hasPurchased = await orderModel.find({
      user: userId,
      "items.book": bookId,
      status: "delivered",
    });

    if (!hasPurchased) {
      return res.status(403).json({
        success: false,
        message: "You can review only after Delivery",
      });
    } else if (hasPurchased) {
      isVerifiedPurchase = true;
    }

    // create review
    const review = await reviewModel.create({
      book: bookId,
      user: userId,
      rating,
      comment,
      isVerifiedPurchase,
    });

    // calculate book rating summary
    const stats = await reviewModel.aggregate([
      {
        $match: {
          book: book._id,
          isActive: true,
          isApproved: true,
        },
      },
      {
        $group: {
          _id: "$book",
          averateRating: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    book.ratings.average = stats.length
      ? Number(stats[0].averateRating.toFixed(1))
      : 0;

    book.ratings.count = stats.length ? stats[0].count : 0;

    await book.save();

    return res.status(201).json({
      success: false,
      message: "Review added successfully",
      data: review,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
    });
  }
};

export const getReviewsByBook = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { page = 1, limit = 10, sort = "latest" } = req.body;

    // pagination logic
    const skip = Number(page - 1) * Number(limit);

    // base filter
    const filter = {
      book: bookId,
      isActive: true,
      isApproved: true,
    };

    // sort logic
    let sortBy = { createdAt: -1 }; // latest first

    if (sort === "rating") {
      sortBy = { rating: -1 };
    }

    if (sort === "verified") {
      sortBy = { isVerifiedPurchase: -1, createdAt: -1 };
    }

    // fetch reviews
    const reviews = await reviewModel
      .find(filter)
      .populate({
        path: "user",
        select: "name",
      })
      .sort(sortBy)
      .skip(skip)
      .limit(Number(limit));

    // total count
    const totalReviews = await reviewModel.countDocuments(filter);

    return res.status(200).json({
      success: true,
      totalReviews,
      currentPage: Number(page),
      tatalPages: Math.ceil(totalReviews / limit),
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      message: "Something went wrong.",
    });
  }
};

export const deleteOwnReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { reviewId } = req.params;

    // find reivew
    const review = await reviewModel.findOne({
      _id: reviewId,
      isActive: true,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    // ownership check
    if (review.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this review",
      });
    }

    // soft delete review
    review.isActive = false;
    await review.save();

    // Recalculate book rating summary
    const stats = await reviewModel.aggregate([
      {
        $match: {
          book: review.book,
          isActive: true,
          isApproved: true,
        },
      },
      {
        $group: {
          _id: "$book",
          averageRating: { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    const book = await bookModel.findById(review.book);

    if (book) {
      book.ratings.average = stats.length
        ? Number(stats[0].averageRating.toFixed(1))
        : 0;

      book.ratings.count = stats.length ? stats[0].count : 0;

      await book.save();
    }

    return res.status(200).json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      message: "Something went wrong.",
    });
  }
};
